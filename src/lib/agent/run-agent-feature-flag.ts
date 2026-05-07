/**
 * Env-var gate for the AI-SDK inner-loop runner (Phase D-3 of the Wizard
 * AI-SDK migration plan).
 *
 * When `AMPLITUDE_WIZARD_AI_SDK_INNER_LOOP=1` is set, callers route to the
 * new {@link runAiSdkAgent} (`./run-agent.ts`) instead of the legacy Claude
 * Agent SDK path in `agent-interface.ts`. Default-off so this PR ships dark
 * — D-5 flips the default; D-6 deletes the legacy path.
 *
 * Centralized so `agent-runner.ts` and any benchmark harness can ask the
 * same question without re-parsing the env var or copying the truthy-set
 * convention.
 */
export const AI_SDK_INNER_LOOP_ENV_VAR = 'AMPLITUDE_WIZARD_AI_SDK_INNER_LOOP';

/**
 * Truthy values that opt the wizard into the AI-SDK runner. Mirrors the
 * convention used by the Vercel AI SDK gateway probe (`AMPLITUDE_WIZARD_AI_SDK_PROBE`)
 * and the skill-tier flag (`AMPLITUDE_WIZARD_SKILL_TIERS`) — `1` is the
 * canonical value, `true` / `yes` accepted as ergonomics.
 */
const TRUTHY = new Set(['1', 'true', 'yes']);

/**
 * Returns true when the AI-SDK inner-loop runner should be used for this
 * wizard run. Reads from `process.env` so tests can stub via
 * `vi.stubEnv(AI_SDK_INNER_LOOP_ENV_VAR, '1')`.
 */
export function isAiSdkInnerLoopEnabled(
  envValue: string | undefined = process.env[AI_SDK_INNER_LOOP_ENV_VAR],
): boolean {
  if (!envValue) return false;
  return TRUTHY.has(envValue.trim().toLowerCase());
}
