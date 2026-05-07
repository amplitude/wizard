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
  // doesn't pay the import cost.
  logToFile(
    '[ai-sdk-runner] AMPLITUDE_WIZARD_AI_SDK_INNER_LOOP=1 — using AI-SDK inner loop',
  );
  const [{ runAiSdkAgent }, { createWizardAiSdkAnthropic }] = await Promise.all(
    [import('./run-agent.js'), import('./wizard-ai-sdk-anthropic.js')],
  );

  spinner.start(config?.spinnerMessage ?? 'Customizing your Amplitude setup…');

  try {
    const provider = createWizardAiSdkAnthropic();
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

    if (result.error) {
      spinner.stop(config?.errorMessage ?? 'Integration failed');
      return { error: result.error, message: result.message };
    }
    spinner.stop(config?.successMessage ?? 'Amplitude integration complete');
    return {};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logToFile('[ai-sdk-runner] runAgentDispatch threw:', message);
    spinner.stop(config?.errorMessage ?? 'Integration failed');
    throw err;
  }
}
