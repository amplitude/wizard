/**
 * Transient LLM / gateway error classification for {@link runAgent} retry loops.
 * Keeps pattern strings and HTTP extraction in one place (Phase D).
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
   */
  upstream?: unknown;
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
        return {
          status,
          message: err.message,
          upstream: err.upstream,
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
  { pattern: 'API Error: 503', label: 'api_503' },
  { pattern: 'API Error: 529', label: 'api_529' },
  { pattern: 'DEADLINE_EXCEEDED', label: 'deadline_exceeded' },
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

/** Thrown-error branch: count toward upstream 400 / deadline storm detection. */
export function isThrownErrorCountedAsUpstreamGatewayFailure(
  errMsg: string,
): boolean {
  return (
    errMsg.includes('API Error: 400') || errMsg.includes('DEADLINE_EXCEEDED')
  );
}

/**
 * Thrown-error branch: worth a full retry (fresh conversation / drain prior
 * stream) when below MAX_RETRIES.
 */
export function isTransientThrownSdkErrorMessage(errMsg: string): boolean {
  return (
    errMsg.includes('tool_use') ||
    errMsg.includes('tool_result') ||
    errMsg.includes('API Error: 400') ||
    errMsg.includes('API Error: 408') ||
    errMsg.includes('API Error: 503') ||
    errMsg.includes('API Error: 529') ||
    errMsg.includes('DEADLINE_EXCEEDED') ||
    errMsg.includes('Stream closed') ||
    errMsg.includes('invalid_request_error')
  );
}
