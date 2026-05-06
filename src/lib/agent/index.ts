export {
  FALLBACK_MODEL_DIRECT,
  FALLBACK_MODEL_GATEWAY,
  sdkStandardFallbackModel,
  selectModel,
} from './model-config.js';
export {
  getConsoleQueryStack,
  type ConsoleQueryStackKind,
} from './console-query-stack.js';
// Type-only re-export — TypeScript erases this at compile time, so importing
// the barrel does NOT eagerly load `@ai-sdk/anthropic`. Value-side symbols
// (`createWizardAiSdkAnthropic`) must be imported directly from
// `./wizard-ai-sdk-anthropic.js`, ideally inside a dynamic import in the
// function that uses them — see `console-query.ts` and the gateway probe.
export type { CreateWizardAiSdkAnthropicOptions } from './wizard-ai-sdk-anthropic.js';
export {
  AGENT_TRANSIENT_SDK_OUTPUT_PATTERNS,
  GATEWAY_INVALID_REQUEST_MARKER,
  extractApiErrorHttpStatusFromPattern,
  extractHttpStatusLooseFromMessage,
  findTransientSdkOutputPattern,
  isThrownErrorCountedAsUpstreamGatewayFailure,
  isTransientThrownSdkErrorMessage,
  type TransientSdkOutputMatch,
} from './transient-llm-retry.js';
export {
  enforceAiSdkProbeStrict,
  maybeRunAiSdkGatewayProbe,
} from './ai-sdk-gateway-probe.js';
export type { AiSdkGatewayProbeResult } from './ai-sdk-gateway-probe.js';
export {
  MAX_BASH_SLEEP_SECONDS,
  MAX_CONSECUTIVE_BASH_DENIES,
  createPreToolUseHook,
  wizardCanUseTool,
  isSkillInstallCommand,
  matchesAllowedPrefix,
  isSafeBackgroundedInstall,
  redactToolLogPayload,
  evaluateCanUseToolFileLogging,
} from './tool-policy.js';
export type { PreToolUseHookOptions } from './tool-policy.js';
export { buildSkillTierSystemPromptAppend } from './skill-tier-prompt.js';
export {
  sanitizingFetch,
  sanitizeWizardRequestInit,
  stripSchemaNoise,
} from './gateway-sanitize.js';
