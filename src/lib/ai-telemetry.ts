/**
 * @amplitude/ai integration for the wizard's Claude Agent SDK runs.
 *
 * The backend LLM gateway captures token usage and completions for the
 * proxied path. This module adds the CLI-side surface — which tools the
 * agent picks, latency per call, success/failure, AI/user messages —
 * as `[Agent] *` events that flow into Agent Analytics. It lives next
 * to the existing wizard taxonomy (`wizard cli: *` in `analytics.ts`)
 * and shares the same telemetry API key.
 *
 * `@amplitude/ai` is ESM-only; the wizard's CJS build cannot use a
 * top-level static import. Both the SDK and its integration entry are
 * loaded once on first use via dynamic `import()` (see also
 * `feature-flags.ts` for the same pattern).
 *
 * Disable order (first match wins):
 *   1. AMPLITUDE_WIZARD_AI_TELEMETRY=0  — env kill switch
 *   2. wizard-agent-analytics flag = off/false — feature gate
 *   3. no telemetry API key resolvable — silent no-op
 */

import { analytics, resolveTelemetryApiKey } from '../utils/analytics';
import { FLAG_AGENT_ANALYTICS, getFlag } from './feature-flags';
import { getRunId } from './observability';
import { debug } from '../utils/debug';

export const WIZARD_AGENT_ID = 'amplitude-wizard';
const ENV_KILL_SWITCH = 'AMPLITUDE_WIZARD_AI_TELEMETRY';

/**
 * Structural types covering only the surface the wizard actually uses.
 * Imported via dynamic `import()` so the wizard's CJS build can load
 * the ESM `@amplitude/ai` package without TS module-format errors.
 */
type SessionLike = {
  readonly sessionId: string;
};

type BoundAgentLike = {
  trackSessionEnd: (opts: { sessionId: string }) => void;
  session: (opts?: {
    sessionId?: string | null;
    userId?: string | null;
  }) => SessionLike;
};

type AmplitudeAILike = {
  agent: (id: string, opts?: Record<string, unknown>) => BoundAgentLike;
  flush: () => unknown;
};

type SdkHookFn = (
  inputData: Record<string, unknown>,
  toolUseId: string | null,
  context: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

type SdkHookDict = Record<
  string,
  Array<{ matcher: string | null; hooks: Array<SdkHookFn> }>
>;

export type ClaudeAgentSDKTrackerLike = {
  hooks: (session: SessionLike) => SdkHookDict;
  process: (session: SessionLike, message: unknown) => void;
};

type AmplitudeAIModule = {
  AmplitudeAI: new (opts: {
    apiKey?: string;
    config?: unknown;
  }) => AmplitudeAILike;
  AIConfig: new (opts: {
    contentMode?: string;
    redactPii?: boolean;
  }) => unknown;
};

type ClaudeAgentTrackerModule = {
  ClaudeAgentSDKTracker: new (opts?: {
    defaultProvider?: string;
    defaultModel?: string;
  }) => ClaudeAgentSDKTrackerLike;
};

/** Test-only override for the AmplitudeAI singleton. */
let injectedClient: AmplitudeAILike | null = null;
let cachedClient: AmplitudeAILike | null = null;
let trackerCtor: ClaudeAgentTrackerModule['ClaudeAgentSDKTracker'] | null =
  null;
let initFailed = false;

/** True unless the env kill switch or feature flag explicitly disables. */
export function isAiTelemetryEnabled(): boolean {
  const killSwitch = process.env[ENV_KILL_SWITCH];
  if (killSwitch === '0' || killSwitch === 'false') return false;
  const flag = getFlag(FLAG_AGENT_ANALYTICS);
  if (flag === 'off' || flag === 'false') return false;
  return true;
}

async function loadAmplitudeAI(): Promise<AmplitudeAILike | null> {
  if (injectedClient) return injectedClient;
  if (initFailed) return null;
  if (cachedClient) return cachedClient;
  if (!isAiTelemetryEnabled()) return null;

  const apiKey = resolveTelemetryApiKey();
  if (!apiKey) return null;

  try {
    const mod = (await import('@amplitude/ai')) as unknown as AmplitudeAIModule;
    cachedClient = new mod.AmplitudeAI({
      apiKey,
      // Wizard prompts can contain repo paths, project names, framework
      // detection details — none of it is end-user PII, but we keep
      // content out of `[Agent] *` events until a content review.
      config: new mod.AIConfig({ contentMode: 'metadata_only' }),
    });
    return cachedClient;
  } catch (err) {
    debug('ai-telemetry: AmplitudeAI init failed', err);
    initFailed = true;
    return null;
  }
}

async function loadTrackerCtor(): Promise<
  ClaudeAgentTrackerModule['ClaudeAgentSDKTracker'] | null
> {
  if (trackerCtor) return trackerCtor;
  try {
    const mod = (await import(
      '@amplitude/ai/integrations/claude-agent-sdk'
    )) as unknown as ClaudeAgentTrackerModule;
    trackerCtor = mod.ClaudeAgentSDKTracker;
    return trackerCtor;
  } catch (err) {
    debug('ai-telemetry: ClaudeAgentSDKTracker load failed', err);
    return null;
  }
}

/**
 * Per-attempt bundle: bound agent, session, SDK tracker. All wizard runs
 * roll up under one canonical `agentId` so the LLM Usage Application
 * Registry has a single entry to map.
 */
export interface AiTelemetryAttempt {
  agent: BoundAgentLike;
  session: SessionLike;
  tracker: ClaudeAgentSDKTrackerLike;
  /** Emit `[Agent] Session End`. Idempotent; safe in finally + catch. */
  endSession(): void;
}

const endedSessions = new WeakSet<SessionLike>();

export async function startAiTelemetryAttempt(): Promise<AiTelemetryAttempt | null> {
  const ai = await loadAmplitudeAI();
  if (!ai) return null;
  const TrackerCtor = await loadTrackerCtor();
  if (!TrackerCtor) return null;

  const userId = analytics.getAnonymousId();
  const agent = ai.agent(WIZARD_AGENT_ID, {
    description: 'Amplitude wizard CLI agent runs',
    userId,
  });
  const session = agent.session({
    sessionId: getRunId(),
    userId,
  });
  const tracker = new TrackerCtor({ defaultProvider: 'anthropic' });

  return {
    agent,
    session,
    tracker,
    endSession() {
      if (endedSessions.has(session)) return;
      endedSessions.add(session);
      try {
        agent.trackSessionEnd({ sessionId: session.sessionId });
      } catch (err) {
        debug('ai-telemetry: trackSessionEnd failed', err);
      }
    },
  };
}

/**
 * Merge the tracker's hooks dict into the wizard's existing hooks dict
 * by concatenating per-event matcher arrays. The wizard's hooks run
 * first (preserving the existing observer + gate composition); the
 * tracker's PreToolUse/PostToolUse run as additional concurrent hooks
 * so they observe every tool call without affecting permission gating.
 */
export function mergeTrackerHooks(
  base: SdkHookDict,
  tracker: SdkHookDict,
): SdkHookDict {
  const out: SdkHookDict = { ...base };
  for (const [event, matchers] of Object.entries(tracker)) {
    const existing = out[event] ?? [];
    out[event] = [...existing, ...matchers];
  }
  return out;
}

/** Flush pending `[Agent] *` events. Idempotent and best-effort. */
export async function flushAiTelemetry(): Promise<void> {
  const client = injectedClient ?? cachedClient;
  if (!client) return;
  try {
    const result = client.flush();
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      await (result as Promise<unknown>);
    }
  } catch (err) {
    debug('ai-telemetry: flush failed', err);
  }
}

/**
 * Test-only: inject a mock AmplitudeAI and tracker constructor. Pass null
 * to clear the override and reset cached state between tests.
 */
export function _setAmplitudeAIForTesting(
  client: AmplitudeAILike | null,
  TrackerCtorOverride?:
    | ClaudeAgentTrackerModule['ClaudeAgentSDKTracker']
    | null,
): void {
  injectedClient = client;
  cachedClient = null;
  initFailed = false;
  if (TrackerCtorOverride !== undefined) {
    trackerCtor = TrackerCtorOverride;
  } else if (client === null) {
    trackerCtor = null;
  }
}
