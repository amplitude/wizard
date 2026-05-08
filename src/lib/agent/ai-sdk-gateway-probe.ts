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
 * In-memory cache of successful gateway probe results, keyed by
 * `${baseURL}|${tokenHash}`. The probe adds a Haiku round-trip (~500-1500ms)
 * on cold start; once we've proven the gateway is reachable for a given
 * (baseURL, token) pair within the current process there is no value in
 * re-running it.
 *
 * Failures are intentionally NOT cached — if the gateway recovers we want a
 * subsequent wizard run inside the same process to re-probe.
 *
 * Lifetime is process-scoped (module-level Map). Nothing persists to disk.
 *
 * The cache key never contains the raw bearer; we hash it with SHA-256 and
 * truncate to 16 hex chars, which is collision-safe enough for this in-memory
 * dedupe and keeps secrets out of any inadvertent log of the cache key.
 */
const successfulProbeCache = new Map<string, AiSdkGatewayProbeResult>();

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

function buildCacheKey(baseURL: string, token: string): string {
  return `${baseURL}|${hashToken(token)}`;
}

/**
 * Test-only escape hatch — clears the in-memory probe cache so each test can
 * assert the underlying call count without leaking state across cases.
 */
export function __resetGatewayProbeCacheForTesting(): void {
  successfulProbeCache.clear();
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
  const cached = successfulProbeCache.get(cacheKey);
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
    // Only memoize success — if the gateway recovers we want the next call
    // inside this process to actually re-run the probe.
    successfulProbeCache.set(cacheKey, okResult);
    return okResult;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logToFile('AI SDK gateway probe failed:', err);
    return { status: 'error', message };
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
