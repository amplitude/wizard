import type { AgentRunConfig } from '../agent-interface.js';

/**
 * Which stack handles ConsoleView slash prompts (in-process).
 * {@link AMPLITUDE_WIZARD_AI_SDK_CONSOLE} opts into Vercel AI SDK; local CLI
 * runs always use the Agent SDK because there is no HTTP endpoint to call.
 *
 * Distinct from {@link getAgentDriver} in `agent-driver.ts`, which resolves
 * the lazy `query()` implementation for `runAgent`.
 */
export type ConsoleQueryStackKind = 'claude-agent-sdk' | 'vercel-ai-sdk';

export function getConsoleQueryStack(
  agentConfig: AgentRunConfig,
): ConsoleQueryStackKind {
  if (process.env.AMPLITUDE_WIZARD_AI_SDK_CONSOLE !== '1') {
    return 'claude-agent-sdk';
  }
  if (agentConfig.useLocalClaude) {
    return 'claude-agent-sdk';
  }
  return 'vercel-ai-sdk';
}
