/**
 * Transient LLM / gateway error classification + backoff helpers for the
 * {@link runAgent} retry loop. Keeps pattern strings, HTTP extraction,
 * jittered backoff, and the per-process retry budget in one place so the
 * outer loop in `agent-interface.ts` is small and the math is unit-testable.
 *
 * Two pieces of behaviour live here:
 *
 *   1. Pattern classifiers (Phase D) — `findTransientSdkOutputPattern`,
 *      `extractApiErrorHttpStatusFromPattern`, etc.
 *   2. Reliability primitives (this file) — `computeRetryBackoffMs`,
 *      `getRetryBudget`. Used by `runAgent` to schedule the next attempt
 *      after a transient stall / 5xx without thundering-herding the
 *      gateway and without spending more than a per-process retry budget.
 *
 * Audit (May 2026) measured a 4:35 burst with 13 SDK-internal `api_retry`
 * events totalling 41.3s of backoff. The SDK runs its own retries (we just
 * observe `api_retry` system messages); the helpers here govern the OUTER
 * loop — the wizard-owned retry path that re-spawns the SDK conversation
 * after a stall or post-stream classifier-detected failure. Improvements:
 *
 *   - Full-jitter additive formula instead of symmetric ±25% (decorrelates
 *     parallel sessions backing off against the same gateway window).
 *   - `Retry-After` honoured: the most recent SDK-reported `retry_delay_ms`
 *     becomes a floor for the next backoff so we never undercut the
 *     server's instruction.
 *   - Per-process retry budget (5 retries) so back-to-back `runAgent`
 *     calls in one wizard session don't independently burn 5 retries each.
 */

/**
 * Legacy fallback marker the gateway's `wizard-proxy` used to clamp every
 * Vertex 400 to. Newer proxy builds (`wizard-proxy/router.ts:325
 * buildUpstreamErrorBody`) pass the actual upstream error message through
 * for 400s and only fall back to this string when the upstream body is
 * empty / non-JSON. We keep the substring match for backward-compat with
 * old proxy builds and the rare unstructured fallback case; new code
 * should prefer {@link parseStructuredUpstreamError}.
 */
export const GATEWAY_INVALID_REQUEST_MARKER =
  'Invalid request sent to model provider';

/**
 * Structured shape returned by the modern `wizard-proxy` on a 400, after the
 * proxy parses Vertex's error body and strips sensitive fields:
 *
 * ```json
 * { "type": "error",
 *   "error": { "type": "api_error",
 *              "message": "<Vertex's actual rejection reason>",
 *              "upstream": <sanitized Vertex body> } }
 * ```
 *
 * The Anthropic SDK formats this as `API Error: 400 <stringified-json>` in
 * its thrown error message and stream output, so the wizard sees it as a
 * substring of an `API Error: NNN ...` line. {@link parseStructuredUpstreamError}
 * pulls the JSON back out so the retry classifier can branch on
 * `error.upstream` (payload-shape rejection — don't retry) vs the absence
 * of it (transient gateway issue — retry).
 */
export interface StructuredUpstreamError {
  /** HTTP status the proxy returned to the wizard (typically 400). */
  status: number;
  /** Human-readable message — usually Vertex's actual rejection reason. */
  message: string;
  /**
   * Vertex's parsed (and sanitized) error body. Presence is the signal
   * that this is a payload-shape rejection and retrying is futile;
   * absence means the proxy fell back to a generic message and the
   * caller should treat it as a transient gateway issue.
   *
   * Modern proxy builds also expose two well-known fields on this object
   * when the rejection is "this model isn't on Vertex's allowlist":
   * `received_model` (the model name the wizard sent) and
   * `supported_models` (the list of names Vertex would have accepted).
   * When present, the runner uses them to render an actionable
   * `"Model 'X' is not supported. Try one of: ..."` remediation line
   * instead of the verbatim Vertex message.
   */
  upstream?: unknown;
  /**
   * Convenience accessors populated when the proxy includes
   * `error.upstream.received_model` (the model name the wizard sent).
   * Keeps callers from spelunking through `unknown`.
   */
  receivedModel?: string;
  /** `error.upstream.supported_models` — names Vertex would have accepted. */
  supportedModels?: string[];
}

/**
 * Extract the well-known `received_model` / `supported_models` fields from
 * the proxy's `error.upstream` envelope. Both are optional — older proxy
 * builds don't surface them, and not every payload-shape rejection carries
 * them (e.g. `additionalProperties` schema rejections). Returns plain values
 * so `unknown` doesn't leak past this module.
 *
 * Exported for unit testing.
 */
export function extractUpstreamModelFields(upstream: unknown): {
  receivedModel?: string;
  supportedModels?: string[];
} {
  if (upstream === null || typeof upstream !== 'object') return {};
  const u = upstream as Record<string, unknown>;
  const out: { receivedModel?: string; supportedModels?: string[] } = {};
  if (typeof u.received_model === 'string' && u.received_model.length > 0) {
    out.receivedModel = u.received_model;
  }
  if (Array.isArray(u.supported_models)) {
    const models = u.supported_models.filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
    if (models.length > 0) out.supportedModels = models;
  }
  return out;
}

/**
 * Build the actionable remediation line we surface to the user when the
 * proxy's structured 400 carries `received_model` + `supported_models`.
 * Returns `null` when either field is missing — callers should fall back
 * to the proxy's verbatim `message`.
 */
export function formatUnsupportedModelMessage(
  err: Pick<StructuredUpstreamError, 'receivedModel' | 'supportedModels'>,
): string | null {
  if (!err.receivedModel || !err.supportedModels?.length) return null;
  return `Model '${
    err.receivedModel
  }' is not supported. Try one of: ${err.supportedModels.join(', ')}`;
}

/**
 * Try to extract the proxy's structured error envelope from an SDK-formatted
 * error string of the form `API Error: NNN { ...json... }`. Returns `null`
 * when no JSON envelope is present (e.g. the SDK emitted a plain string,
 * the error came from a different layer, or the proxy returned a non-JSON
 * fallback). Pure — no side effects.
 *
 * Exported for unit testing.
 */
export function parseStructuredUpstreamError(
  text: string,
): StructuredUpstreamError | null {
  // Match `API Error: NNN ` followed by an opening brace. We don't try to
  // greedy-match to the closing brace — JSON.parse will fail fast on a
  // truncated body and we'll return null, which is the right behavior.
  const m = text.match(/API Error: (\d{3})\s+(\{[\s\S]*)/);
  if (!m) return null;

  const status = Number(m[1]);
  const jsonCandidate = m[2];

  // The SDK may append text after the JSON envelope (e.g. retry hints).
  // Try progressively shorter prefixes ending at a `}` so we don't fail
  // on trailing garbage. Cap iterations so a pathological payload can't
  // burn unbounded CPU.
  let lastBrace = jsonCandidate.lastIndexOf('}');
  for (let attempts = 0; attempts < 8 && lastBrace > 0; attempts++) {
    const candidate = jsonCandidate.slice(0, lastBrace + 1);
    try {
      const parsed = JSON.parse(candidate) as {
        type?: string;
        error?: {
          type?: string;
          message?: string;
          upstream?: unknown;
        };
      };
      const err = parsed?.error;
      if (err && typeof err.message === 'string') {
        const { receivedModel, supportedModels } = extractUpstreamModelFields(
          err.upstream,
        );
        return {
          status,
          message: err.message,
          upstream: err.upstream,
          ...(receivedModel ? { receivedModel } : {}),
          ...(supportedModels ? { supportedModels } : {}),
        };
      }
      // Parsed but didn't match the expected shape — give up rather than
      // try shorter prefixes (those won't be valid JSON anyway).
      return null;
    } catch {
      // Try a shorter prefix on the next iteration.
      lastBrace = jsonCandidate.lastIndexOf('}', lastBrace - 1);
    }
  }
  return null;
}

/**
 * Decide whether a parsed structured error should short-circuit the retry
 * loop. Payload-shape rejections (400 + `upstream` field present) are
 * deterministic — the next retry will fail identically. A 400 without
 * `upstream` came from a non-Vertex proxy code path (rate, auth) and
 * should fall through to the generic transient classifier.
 */
export function isPayloadShapeRejection(err: StructuredUpstreamError): boolean {
  return err.status === 400 && err.upstream !== undefined;
}

export const AGENT_TRANSIENT_SDK_OUTPUT_PATTERNS = [
  { pattern: 'API Error: 400', label: 'api_400' },
  { pattern: 'API Error: 408', label: 'api_408' },
  // 502 / 504 are transient gateway-frontend failures (Vertex backend hop
  // dies, regional saturation). The proxy retries Vertex 5xx server-side,
  // but if the SDK's internal retry budget exhausts before recovery, the
  // wizard's outer loop must pick up where it left off. Without these
  // entries, a sustained 502/504 storm exits as a generic API_ERROR
  // instead of triggering a fresh-conversation retry.
  { pattern: 'API Error: 502', label: 'api_502' },
  { pattern: 'API Error: 503', label: 'api_503' },
  { pattern: 'API Error: 504', label: 'api_504' },
  { pattern: 'API Error: 529', label: 'api_529' },
  { pattern: 'DEADLINE_EXCEEDED', label: 'deadline_exceeded' },
  // Per-chunk stream timeout from `wizard-proxy/streaming.ts`: the proxy
  // bounds the gap between SSE chunks coming back from Vertex, and emits
  // a sentinel error when the gap exceeds the threshold. A whole-request
  // 408 / DEADLINE_EXCEEDED won't fire here because the connection is
  // already streaming — without this matcher a chunk-deadline storm exits
  // as a generic API_ERROR with no outer-loop retry. Match a couple of
  // sentinel substrings so the matcher is robust to copy tweaks on the
  // proxy side. Re-classified as transient (retry the whole
  // conversation) the same way `DEADLINE_EXCEEDED` is.
  { pattern: 'chunk_deadline_exceeded', label: 'chunk_deadline_exceeded' },
  { pattern: 'stream chunk timeout', label: 'chunk_deadline_exceeded' },
] as const;

export type TransientSdkOutputMatch =
  (typeof AGENT_TRANSIENT_SDK_OUTPUT_PATTERNS)[number];

export function findTransientSdkOutputPattern(
  partialOutput: string,
): TransientSdkOutputMatch | undefined {
  return AGENT_TRANSIENT_SDK_OUTPUT_PATTERNS.find((m) =>
    partialOutput.includes(m.pattern),
  );
}

/** Pull a 3-digit status out of an `API Error: NNN ...` pattern. */
export function extractApiErrorHttpStatusFromPattern(
  pattern: string,
): number | null {
  const m = pattern.match(/API Error: (\d{3})/);
  return m ? Number(m[1]) : null;
}

/** Extract the first HTTP status seen in an error message, if any. */
export function extractHttpStatusLooseFromMessage(msg: string): number | null {
  const m = msg.match(/\b([4-5]\d{2})\b/);
  return m ? Number(m[1]) : null;
}

/**
 * Thrown-error branch: count toward upstream-gateway-storm detection.
 *
 * Hits in this set drive the `GATEWAY_DOWN` exit-code path with the
 * actionable "set ANTHROPIC_API_KEY to bypass the wizard gateway" copy.
 * Without 408 here, a pure timeout-storm coming back from the proxy
 * would exit as a generic API_ERROR and miss that remediation hint.
 *
 * 5xx is intentionally NOT in this set: the proxy itself retries Vertex
 * 5xx server-side, and "the gateway is down" is the wrong diagnosis for
 * a Vertex-side regional outage. Those still get a normal transient
 * retry via `isTransientThrownSdkErrorMessage`.
 */
export function isThrownErrorCountedAsUpstreamGatewayFailure(
  errMsg: string,
): boolean {
  return (
    errMsg.includes('API Error: 400') ||
    errMsg.includes('API Error: 408') ||
    errMsg.includes('DEADLINE_EXCEEDED')
  );
}

/**
 * Patterns that appear ONLY in thrown errors (never in mid-stream SDK
 * output) and still warrant a transient retry. Joined with
 * `AGENT_TRANSIENT_SDK_OUTPUT_PATTERNS` to form the thrown-error matcher
 * so adding a new pattern updates both classifiers in one place.
 *
 *  - `tool_use` / `tool_result` — mid-conversation tool-block validation
 *    errors that surface as a thrown SDK error, not a stream chunk.
 *  - `Stream closed` — the SDK's own "stream ended unexpectedly" wrap.
 *  - `invalid_request_error` — Anthropic's typed error shape for a
 *    rejected request body (distinct from the proxy's API-Error wrap).
 */
const THROWN_ONLY_TRANSIENT_PATTERNS: ReadonlyArray<string> = [
  'tool_use',
  'tool_result',
  'Stream closed',
  'invalid_request_error',
];

/**
 * Thrown-error branch: worth a full retry (fresh conversation / drain prior
 * stream) when below MAX_RETRIES.
 *
 * Derived from `AGENT_TRANSIENT_SDK_OUTPUT_PATTERNS` plus a small set of
 * thrown-only patterns so adding a new transient SDK output pattern (e.g.
 * a new `API Error: NNN` status) automatically flows into the thrown-error
 * classifier too. See `THROWN_ONLY_TRANSIENT_PATTERNS` for the extras.
 */
export function isTransientThrownSdkErrorMessage(errMsg: string): boolean {
  for (const { pattern } of AGENT_TRANSIENT_SDK_OUTPUT_PATTERNS) {
    if (errMsg.includes(pattern)) return true;
  }
  for (const pattern of THROWN_ONLY_TRANSIENT_PATTERNS) {
    if (errMsg.includes(pattern)) return true;
  }
  return false;
}

// ── Backoff math ────────────────────────────────────────────────────

/** Base unit for the outer-loop backoff curve, in milliseconds. */
export const RETRY_BACKOFF_BASE_MS = 2_000;
/** Cap for any single backoff sleep, in milliseconds. */
export const RETRY_BACKOFF_CAP_MS = 30_000;

/**
 * Compute the next backoff delay using an additive "full jitter" formula:
 *
 *   delay = min(cap, base * 2^attempt + uniform(0, base))
 *
 * Then clamped to be at least `retryAfterMs` (the most recent SDK-reported
 * `retry_delay_ms` from an `api_retry` system message, when present), and
 * never less than `base` so an over-eager fast retry can't starve the
 * upstream further.
 *
 * Pure for unit testing — pass a deterministic `random` to assert exact
 * values. Default `random` is `Math.random` so production callers get the
 * jittered curve for free.
 *
 * @param attempt           Zero-based retry index (1 ⇒ first retry, 2 ⇒ second…).
 * @param retryAfterMs      Lower bound from the upstream's `Retry-After` /
 *                          SDK `retry_delay_ms`, when known. Pass `null` to
 *                          skip clamping. Negative values are ignored.
 * @param random            Override for `Math.random` (test seam). Returns
 *                          a number in `[0, 1)`.
 * @param base              Override for `RETRY_BACKOFF_BASE_MS` (test seam).
 * @param cap               Override for `RETRY_BACKOFF_CAP_MS` (test seam).
 */
export function computeRetryBackoffMs(
  attempt: number,
  retryAfterMs: number | null = null,
  random: () => number = Math.random,
  base: number = RETRY_BACKOFF_BASE_MS,
  cap: number = RETRY_BACKOFF_CAP_MS,
): number {
  // attempt is 1-indexed in the runAgent loop (`attempt > 0` triggers the
  // backoff branch), but the math reads cleanly with a zero-based exponent
  // so we shift here. Clamp to non-negative so a stray 0 / negative input
  // doesn't blow up Math.pow.
  const exp = Math.max(0, attempt - 1);
  const exponential = base * Math.pow(2, exp);
  const additiveJitter = base * Math.max(0, Math.min(1, random()));
  let delay = Math.min(cap, exponential + additiveJitter);
  if (
    retryAfterMs !== null &&
    Number.isFinite(retryAfterMs) &&
    retryAfterMs > 0
  ) {
    // Honour the gateway / Vertex `Retry-After` floor so we never undercut
    // the server's instruction. Still cap at `cap` so a runaway server
    // header can't hang the run for hours — at the cap the user gets a
    // clean GATEWAY_DOWN classification on the next attempt instead.
    delay = Math.min(cap, Math.max(delay, retryAfterMs));
  }
  return Math.round(delay);
}

// ── Per-process retry budget ───────────────────────────────────────

/**
 * Default per-process retry budget. The wizard makes at most one big
 * agent run per session today, but `runAgent` is wrapped by integration
 * verification flows that may invoke it again (`additionalFeatureQueue`,
 * post-agent re-runs). Without a process-scoped budget each call would
 * independently burn 5 retries against the same rate-limited window.
 */
export const RETRY_BUDGET_PER_SESSION = 5;

/**
 * Tracks how many retries the wizard has consumed across the entire
 * process. Each `tryConsume()` returns `true` when a retry slot is
 * available and decrements the budget; `false` once exhausted. The
 * outer loop short-circuits on `false` and surfaces a `RATE_LIMIT` /
 * persistent-failure error to the user instead of looping further.
 *
 * Process-scoped (not per-call) so a wizard session that issues
 * multiple `runAgent()` calls (e.g. integration → verify → fix) shares
 * a single retry pool. Reset by `reset()` from tests; production code
 * never resets — the wizard exits on budget exhaustion.
 */
export interface RetryBudget {
  /** Total budget the session started with. */
  readonly limit: number;
  /** Retries left. 0 means exhausted. */
  remaining(): number;
  /** Try to consume one retry. Returns `true` on success. */
  tryConsume(): boolean;
  /** Test-only: restore the budget to `limit`. */
  reset(): void;
}

function makeRetryBudget(limit: number): RetryBudget {
  let used = 0;
  return {
    limit,
    remaining(): number {
      return Math.max(0, limit - used);
    },
    tryConsume(): boolean {
      if (used >= limit) return false;
      used++;
      return true;
    },
    reset(): void {
      used = 0;
    },
  };
}

let processRetryBudget: RetryBudget | null = null;

/**
 * Singleton per-process retry budget. Lazily constructed on first call so
 * tests that import this module before configuring `RETRY_BUDGET_PER_SESSION`
 * still see a sensible default. Production callers (the runAgent loop)
 * use this directly; tests should call `resetRetryBudgetForTests` between
 * cases.
 */
export function getRetryBudget(): RetryBudget {
  if (!processRetryBudget) {
    processRetryBudget = makeRetryBudget(RETRY_BUDGET_PER_SESSION);
  }
  return processRetryBudget;
}

/** Test-only: reset the singleton so the next `getRetryBudget()` returns a fresh budget. */
export function resetRetryBudgetForTests(): void {
  processRetryBudget = null;
}
