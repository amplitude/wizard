/**
 * Dispatch shim — chooses between the legacy Claude Agent SDK runner
 * (`agent-interface.ts:runAgent`) and the AI-SDK runner
 * (`./run-agent.ts:runAiSdkAgent`) based on the
 * `AMPLITUDE_WIZARD_AI_SDK_INNER_LOOP` env flag (Phase D-3).
 *
 * Default: legacy runner. Flag-on: AI-SDK runner.
 *
 * Why this lives in its own file:
 *   - `agent-runner.ts` shouldn't import the AI-SDK heavy modules
 *     (`ai`, `@ai-sdk/anthropic`) on every wizard run. The dispatch
 *     helper dynamic-imports them only when the gate is open.
 *   - Keeps the single call site in `agent-runner.ts` to one
 *     `runAgentDispatch(...)` line — the bridge for the parity
 *     measurement window before D-5 / D-6.
 *   - When D-6 deletes the legacy runner, this file shrinks to a
 *     direct re-export and the env-flag check moves to a test-only
 *     codepath.
 */
import type { SpinnerHandle } from '../../ui/wizard-ui.js';
import type { WizardOptions } from '../../utils/types.js';
import type { AgentErrorType, AgentRunConfig } from '../agent-interface.js';
import type { SDKMessage } from '../middleware/types.js';
import type { AdditionalFeature } from '../wizard-session.js';
import { logToFile } from '../../utils/debug.js';
import { parseAnthropicCustomHeaderBlock } from '../../utils/custom-headers.js';
import { isAiSdkInnerLoopEnabled } from './run-agent-feature-flag.js';

export type RunAgentDispatchExtras = {
  estimatedDurationMinutes?: number;
  spinnerMessage?: string;
  successMessage?: string;
  errorMessage?: string;
  additionalFeatureQueue?: () => readonly AdditionalFeature[];
  onFeatureStart?: (feature: AdditionalFeature) => void;
  onFeatureComplete?: (feature: AdditionalFeature) => void;
  onPreCompact?: (input: { trigger: 'manual' | 'auto' }) => void;
  onCircuitBreakerTripped?: (info: {
    consecutiveDenies: number;
    lastCommand: string;
    lastDenyReason: string;
  }) => void;
};

export type RunAgentDispatchMiddleware = {
  onMessage(message: SDKMessage): void;
  finalize(resultMessage: SDKMessage, totalDurationMs: number): unknown;
};

export interface RunAgentDispatchResult {
  error?: AgentErrorType;
  message?: string;
  plannedEvents?: Array<{ name: string; description: string }>;
}

/**
 * Build the per-run header map the AI-SDK provider should forward to
 * the gateway, mirroring the legacy SDK path. The legacy
 * `agent-interface.ts:runAgent` sets `ANTHROPIC_CUSTOM_HEADERS` in the
 * subprocess env; the AI-SDK transport doesn't read that env var, so
 * we replicate the exact same headers map and pass it directly to
 * `createAnthropic({ headers })`.
 *
 * Critically, this includes the `x-amp-wizard-session-id` header so
 * Agent Analytics correlates every `/v1/messages` call from a single
 * wizard run into one session. Without it, the proxy falls back to
 * a deterministic session ID derived from the auth-token hash, which
 * collapses every wizard run a user ever does into the same session
 * (see `WIZARD_SESSION_ID_HEADER` in `agent-interface.ts`).
 *
 * Exported for unit testing.
 */
export function buildAiSdkProviderHeaders(args: {
  wizardMetadata?: Record<string, string>;
  wizardFlags?: Record<string, string>;
  agentSessionId?: string;
  buildAgentEnvImpl: (
    wizardMetadata: Record<string, string>,
    wizardFlags: Record<string, string>,
    agentSessionId?: string,
  ) => string;
}): Record<string, string> {
  const encoded = args.buildAgentEnvImpl(
    args.wizardMetadata ?? {},
    args.wizardFlags ?? {},
    args.agentSessionId,
  );
  return parseAnthropicCustomHeaderBlock(encoded);
}

/**
 * Pick the active runner and forward arguments. The legacy path is
 * default; the AI-SDK path is opt-in via
 * `AMPLITUDE_WIZARD_AI_SDK_INNER_LOOP=1`.
 *
 * Today both paths surface a `{ error?, message?, plannedEvents? }`
 * shape. The AI-SDK path is foundational — it executes a single
 * agent attempt without the full retry / journey-state harness the
 * legacy runner provides — so production users running with the flag
 * on may see slightly different terminal text. The smoke parity
 * test in `__tests__/run-agent.test.ts` proves the wire envelope
 * shape is identical.
 */
export async function runAgentDispatch(
  agentConfig: AgentRunConfig,
  prompt: string,
  options: WizardOptions,
  spinner: SpinnerHandle,
  config?: RunAgentDispatchExtras,
  middleware?: RunAgentDispatchMiddleware,
): Promise<RunAgentDispatchResult> {
  if (!isAiSdkInnerLoopEnabled()) {
    // Legacy path — preserved verbatim for the parity window.
    const { runAgent } = await import('../agent-interface.js');
    return runAgent(agentConfig, prompt, options, spinner, config, middleware);
  }

  // AI-SDK path — lazy-load the heavier modules so the legacy run
  // doesn't pay the import cost. `buildAgentEnv` lives in
  // `agent-interface.js`, which we already lazy-load on the legacy
  // path; pull it in here too so the AI-SDK path can reuse the exact
  // same header-construction logic (including the
  // `x-amp-wizard-session-id` header — without it, Agent Analytics
  // collapses every wizard run into one session).
  logToFile(
    '[ai-sdk-runner] AMPLITUDE_WIZARD_AI_SDK_INNER_LOOP=1 — using AI-SDK inner loop',
  );
  const [{ runAiSdkAgent }, { createWizardAiSdkAnthropic }, { buildAgentEnv }] =
    await Promise.all([
      import('./run-agent.js'),
      import('./wizard-ai-sdk-anthropic.js'),
      import('../agent-interface.js'),
    ]);

  spinner.start(config?.spinnerMessage ?? 'Customizing your Amplitude setup…');

  // Bridge the legacy middleware contract to the AI-SDK runner. The
  // observability / retry / benchmark middleware in
  // `agent-runner.ts:createObservabilityMiddleware` (and friends)
  // expect `onMessage(SDKMessage)` + `finalize(resultMessage,
  // totalDurationMs)` calls to keep emitting structured logs, Sentry
  // breadcrumbs, NDJSON `agent_metrics` envelopes, and analytics
  // events. The AI-SDK runner doesn't speak the legacy SDK message
  // shape, so we synthesize the minimum shape the always-on
  // observability path consumes:
  //   - `system: init` at the top of the run (matches the legacy
  //     `system_message_received` lifecycle in agent-interface.ts).
  //   - one `result` message with `usage`, `total_cost_usd`,
  //     `is_error`, and `num_turns` derived from the AI-SDK runner
  //     return value, so `emitAgentMetrics` fires with full data.
  // Per-message shapes (assistant tool_use, tool_result, etc.) are
  // deferred to D-4 — the always-on observability path doesn't
  // require them, and the NDJSON `tool_call` events already flow
  // through `run-agent-events.ts`.
  const dispatchStartedAt = Date.now();
  if (middleware) {
    try {
      middleware.onMessage({ type: 'system', subtype: 'init' } as SDKMessage);
    } catch (err) {
      logToFile(
        '[ai-sdk-runner] middleware.onMessage(system:init) threw (non-fatal):',
        err,
      );
    }
  }

  try {
    const headers = buildAiSdkProviderHeaders({
      wizardMetadata: agentConfig.wizardMetadata,
      wizardFlags: agentConfig.wizardFlags,
      agentSessionId: agentConfig.agentSessionId,
      buildAgentEnvImpl: buildAgentEnv,
    });
    const provider = createWizardAiSdkAnthropic({ headers });
    // The model id forwarded to the gateway is the same alias the
    // legacy SDK uses (e.g. `anthropic/claude-sonnet-4-6`) — see
    // `selectModel` in `model-config.ts`. `agentConfig.model` carries
    // it through unchanged.
    const result = await runAiSdkAgent({
      workingDirectory: agentConfig.workingDirectory,
      prompt,
      model: provider(agentConfig.model),
      targetsBrowser: agentConfig.targetsBrowser,
      orchestratorContext: agentConfig.orchestratorContext,
      wizardOptions: options,
      onCompactionStarted: config?.onPreCompact,
    });

    // Build the synthesized terminal SDKMessage that observability /
    // benchmark middleware consume. Field names mirror the legacy
    // SDK's `result` message exactly.
    const totalDurationMs = Date.now() - dispatchStartedAt;
    const resultMessage: SDKMessage = {
      type: 'result',
      is_error: !!result.error,
      ...(result.error ? { result: result.message } : {}),
      usage: {
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        cache_read_input_tokens: result.usage.cacheReadTokens,
        cache_creation_input_tokens: result.usage.cacheWriteTokens,
      },
      // AI-SDK runner doesn't yet surface a per-run cost or a
      // separate turn count — D-4 will plumb both through. Until
      // then `total_cost_usd` is undefined (observability already
      // tolerates that) and `num_turns` falls back to tool-call
      // count, which is the closest signal we have.
      num_turns: result.toolCalls.length,
    };

    if (middleware) {
      try {
        middleware.finalize(resultMessage, totalDurationMs);
      } catch (err) {
        logToFile(
          '[ai-sdk-runner] middleware.finalize threw (non-fatal):',
          err,
        );
      }
    }

    if (result.error) {
      spinner.stop(config?.errorMessage ?? 'Integration failed');
      return { error: result.error, message: result.message };
    }
    spinner.stop(config?.successMessage ?? 'Amplitude integration complete');
    return {};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logToFile('[ai-sdk-runner] runAgentDispatch threw:', message);
    if (middleware) {
      try {
        middleware.finalize(
          {
            type: 'result',
            is_error: true,
            result: message,
          } as SDKMessage,
          Date.now() - dispatchStartedAt,
        );
      } catch (innerErr) {
        logToFile(
          '[ai-sdk-runner] middleware.finalize (catch path) threw (non-fatal):',
          innerErr,
        );
      }
    }
    spinner.stop(config?.errorMessage ?? 'Integration failed');
    throw err;
  }
}
