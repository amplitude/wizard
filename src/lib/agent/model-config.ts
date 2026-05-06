import type { WizardMode } from '../../utils/types.js';

/**
 * Map a {@link WizardMode} to a Claude model alias. Internal — see
 * `docs/internal/agent-mode-flag.md` for the full mapping.
 *
 * The Amplitude LLM gateway expects the `anthropic/<alias>` prefix; the
 * direct Anthropic API expects the bare alias. The SDK `fallbackModel` is a
 * separate routing path, so a tier the gateway does not vend can degrade
 * without failing the whole run.
 */
export function selectModel(
  mode: WizardMode,
  useDirectApiKey: boolean,
): string {
  let alias: string;
  switch (mode) {
    case 'fast':
      alias = 'claude-haiku-4-5';
      break;
    case 'thorough':
      alias = 'claude-opus-4-7';
      break;
    case 'standard':
    default:
      alias = 'claude-sonnet-4-6';
      break;
  }
  return useDirectApiKey ? alias : `anthropic/${alias}`;
}

/**
 * Fallback model handed to the Claude Agent SDK when the primary model is
 * unavailable (e.g. a Vertex outage on a single model family). The SDK
 * rejects a fallback equal to the primary with `Fallback model cannot be
 * the same as the main model`, so this MUST NOT match any value
 * {@link selectModel} can return for any mode × `useDirectApiKey`. The
 * `selectModel(...) !== FALLBACK_MODEL_*` invariant is pinned by a unit
 * test in `__tests__/model-config.test.ts`. Future "modernize the alias"
 * changes — to either {@link selectModel} or this constant — must keep
 * the two strictly disjoint.
 *
 * Capability: stays in the Sonnet family. The prior alias was the dated
 * `claude-sonnet-4-5-20250514`; the bare `claude-sonnet-4-5` keeps the
 * same family without colliding with `selectModel('standard', ...)`'s
 * `claude-sonnet-4-6`. Haiku is intentionally avoided — the previous
 * author flagged it as too weak for the wizard's code-generation
 * prompts.
 */
export const FALLBACK_MODEL_DIRECT = 'claude-sonnet-4-5';
export const FALLBACK_MODEL_GATEWAY = `anthropic/${FALLBACK_MODEL_DIRECT}`;

/**
 * Fallback model for the Agent SDK when the primary tier is unavailable.
 *
 * Returns a constant disjoint from every value {@link selectModel} can
 * return — the Claude Agent SDK rejects a `fallbackModel` that equals the
 * `model` with `Fallback model cannot be the same as the main model`,
 * so this helper MUST NOT alias `selectModel('standard', ...)`. See
 * {@link FALLBACK_MODEL_DIRECT} for the long-form rationale and the
 * paired invariant test.
 */
export function sdkStandardFallbackModel(useDirectApiKey: boolean): string {
  return useDirectApiKey ? FALLBACK_MODEL_DIRECT : FALLBACK_MODEL_GATEWAY;
}
