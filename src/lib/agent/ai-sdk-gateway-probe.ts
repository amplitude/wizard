/**
 * Opt-in Vercel AI SDK probe against the same Anthropic-compatible endpoint
 * the Agent SDK uses ({@code ANTHROPIC_BASE_URL} + OAuth or API key).
 *
 * Turn on with {@code AMPLITUDE_WIZARD_AI_SDK_PROBE=1} after env is configured
 * (e.g. end of {@link initializeAgent}). Proves we can stream from the gateway
 * with `ai` + `@ai-sdk/anthropic` before replacing the main harness.
 *
 * Set {@code AMPLITUDE_WIZARD_AI_SDK_PROBE_STRICT=1} to throw on failure
 * (CI / dogfood). Default is log-only so a probe regression never blocks users.
 *
 * The `ai` and `@ai-sdk/anthropic` packages are imported dynamically inside
 * {@link maybeRunAiSdkGatewayProbe} so they only load when the probe actually
 * runs — `agent-interface.ts` calls this on every wizard run, but the env-var
 * gate short-circuits well before any AI SDK code is touched.
 */
import { createHash } from 'node:crypto';

import { logToFile } from '../../utils/debug.js';
import { resolveAnthropicAuth } from './anthropic-auth.js';
import { selectModel } from './model-config.js';

export type AiSdkGatewayProbeResult =
  | { status: 'skipped'; reason: string }
  | { status: 'ok'; preview: string }
  | { status: 'error'; message: string };

/**
 * In-memory cache of gateway probe results, keyed by `${baseURL}|${tokenHash}`.
 * The probe adds a Haiku round-trip (~500-1500ms) on cold start; once we've
 * proven the gateway is reachable for a given (baseURL, token) pair within
 * the current process there is no value in re-running it.
 *
 * Successes are cached for the lifetime of the process. Failures are cached
 * for a short window (`FAILURE_CACHE_TTL_MS`) — long enough to throttle
 * retry storms during a flapping gateway outage (where every retry would
 * otherwise repay 500-1500ms), short enough that we naturally re-probe and
 * recover once the gateway comes back. We throttle, we do not suppress.
 *
 * Lifetime is process-scoped (module-level Map). Nothing persists to disk.
 *
 * The cache key never contains the raw bearer; we hash it with SHA-256 and
 * truncate to 16 hex chars, which is collision-safe enough for this in-memory
 * dedupe and keeps secrets out of any inadvertent log of the cache key.
 */
type CacheEntry = {
  result: AiSdkGatewayProbeResult;
  /** Absolute epoch-ms after which the entry is considered stale. */
  expiresAt: number;
};

/** Brief failure cache window: throttles retry storms during flapping outages. */
const FAILURE_CACHE_TTL_MS = 8_000;

const probeCache = new Map<string, CacheEntry>();

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

function buildCacheKey(baseURL: string, token: string): string {
  return `${baseURL}|${hashToken(token)}`;
}

function readCachedProbeResult(
  cacheKey: string,
  now: number,
): AiSdkGatewayProbeResult | undefined {
  const entry = probeCache.get(cacheKey);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    // Expired — drop it so the next caller does a fresh probe.
    probeCache.delete(cacheKey);
    return undefined;
  }
  return entry.result;
}

/**
 * Test-only escape hatch — clears the in-memory probe cache so each test can
 * assert the underlying call count without leaking state across cases.
 */
export function __resetGatewayProbeCacheForTesting(): void {
  probeCache.clear();
}

/**
 * Single short completion to validate streaming + gateway auth. Does not use tools.
 *
 * Per `MIGRATION_PLAN.md` strategic posture #10 the probe runs on the Haiku
 * one-shot tier — it's a transport check, not reasoning, and we don't want
 * to spend Sonnet tokens proving the gateway is reachable. The `model`
 * argument is no longer threaded through; we resolve Haiku via
 * {@link selectModel} from the wizard auth path.
 */
export async function maybeRunAiSdkGatewayProbe(args: {
  useLocalClaude: boolean;
  /**
   * `true` when the wizard is talking to the Anthropic API directly
   * (bare alias, no `anthropic/` prefix); `false` for the Amplitude LLM
   * gateway. Mirrors the same flag {@link selectModel} takes.
   */
  useDirectApiKey: boolean;
}): Promise<AiSdkGatewayProbeResult> {
  if (process.env.AMPLITUDE_WIZARD_AI_SDK_PROBE !== '1') {
    return {
      status: 'skipped',
      reason: 'AMPLITUDE_WIZARD_AI_SDK_PROBE is not 1',
    };
  }
  if (args.useLocalClaude) {
    return {
      status: 'skipped',
      reason: 'local Claude CLI path has no in-process HTTP endpoint to probe',
    };
  }

  const baseURL = process.env.ANTHROPIC_BASE_URL?.trim();
  const auth = resolveAnthropicAuth();
  if (!baseURL && !auth.apiKey) {
    return {
      status: 'skipped',
      reason: 'missing ANTHROPIC_BASE_URL (gateway) and ANTHROPIC_API_KEY',
    };
  }
  if (!auth.apiKey && !auth.authToken) {
    return {
      status: 'skipped',
      reason: 'missing ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN',
    };
  }

  // Cache key is keyed on the resolved baseURL plus a hash of the bearer the
  // gateway will see. We pick whichever credential `resolveAnthropicAuth`
  // returned (apiKey > authToken, matching the precedence the AI SDK factory
  // uses). The empty string fallback is harmless — both keys cannot both be
  // absent here because we already short-circuited above.
  const cacheToken = auth.apiKey ?? auth.authToken ?? '';
  const cacheKey = buildCacheKey(baseURL ?? '', cacheToken);
  const cached = readCachedProbeResult(cacheKey, Date.now());
  if (cached) {
    return cached;
  }

  try {
    // Dynamic imports keep these substantial packages out of every wizard run;
    // they only load once the env-var gate above lets us through. The shared
    // factory is also dynamically imported so the static `@ai-sdk/anthropic`
    // import in `wizard-ai-sdk-anthropic.ts` only runs when the probe path is
    // exercised.
    const [{ streamText }, { createWizardAiSdkAnthropic, ensureV1Suffix }] =
      await Promise.all([import('ai'), import('./wizard-ai-sdk-anthropic.js')]);

    // Explicitly normalize the baseURL with `ensureV1Suffix` so the AI SDK's
    // `${baseURL}/messages` resolves to `…/v1/messages` against the wizard
    // gateway. The factory applies this internally too, but passing it at the
    // callsite documents the contract (and would survive a factory refactor
    // that ever stopped normalizing).
    const provider = createWizardAiSdkAnthropic({
      baseURL: ensureV1Suffix(baseURL),
    });
    const probeModel = selectModel('oneshot', args.useDirectApiKey);

    const result = streamText({
      model: provider(probeModel),
      maxOutputTokens: 32,
      messages: [
        {
          role: 'user',
          content:
            'Reply with exactly this token and nothing else: wizard_ai_sdk_probe_ok',
        },
      ],
    });

    let text = '';
    for await (const part of result.textStream) {
      text += part;
    }
    const preview = text.replace(/\s+/g, ' ').trim().slice(0, 200);
    logToFile('AI SDK gateway probe finished:', preview);
    const okResult: AiSdkGatewayProbeResult = { status: 'ok', preview };
    // Successes are cached for the lifetime of the process — once the gateway
    // has answered correctly for this (baseURL, token) pair there is no value
    // in re-probing inside the same run.
    probeCache.set(cacheKey, {
      result: okResult,
      expiresAt: Number.POSITIVE_INFINITY,
    });
    return okResult;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logToFile('AI SDK gateway probe failed:', err);
    const errorResult: AiSdkGatewayProbeResult = { status: 'error', message };
    // Failures get a brief TTL so a flapping outage doesn't make every retry
    // pay the 500-1500ms probe cost. After the window expires we re-probe
    // naturally and recover when the gateway recovers.
    probeCache.set(cacheKey, {
      result: errorResult,
      expiresAt: Date.now() + FAILURE_CACHE_TTL_MS,
    });
    return errorResult;
  }
}

export function enforceAiSdkProbeStrict(result: AiSdkGatewayProbeResult): void {
  if (
    result.status === 'error' &&
    process.env.AMPLITUDE_WIZARD_AI_SDK_PROBE_STRICT === '1'
  ) {
    throw new Error(
      `AI SDK gateway probe failed (AMPLITUDE_WIZARD_AI_SDK_PROBE_STRICT=1): ${result.message}`,
    );
  }
}
