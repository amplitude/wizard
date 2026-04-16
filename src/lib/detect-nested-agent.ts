/**
 * Detects whether the wizard is running inside another Claude Code /
 * Claude Agent SDK session.
 *
 * Nesting used to break the wizard: it spawns its own Claude Agent SDK
 * subprocess for the setup agent, and the inner SDK inherited the
 * outer session's `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`,
 * `CLAUDE_CODE_OAUTH_TOKEN`, etc., which caused a 400 from the LLM
 * gateway. `sanitizeNestedClaudeEnv()` now strips those before the
 * inner SDK boots, so nesting works by default.
 *
 * This detector is kept purely as a diagnostic so outer orchestrators
 * (e.g. Claude Code) can log that nesting was seen.
 *
 * Signals (first match wins):
 *   1. `CLAUDECODE=1` — set by the Claude Code CLI in all child processes
 *   2. `CLAUDE_CODE_ENTRYPOINT` — set by `@anthropic-ai/claude-agent-sdk`
 *      when it spawns child processes (e.g. "sdk-ts")
 *
 * Bypass: set `AMPLITUDE_WIZARD_ALLOW_NESTED=1` to suppress the
 * diagnostic entirely.
 */

export type NestedAgentSignal = 'claude_code_cli' | 'claude_agent_sdk';

export interface NestedAgentDetection {
  signal: NestedAgentSignal;
  /** The env var that triggered detection, for the diagnostic message. */
  envVar: string;
  /** Its value at detection time, for the diagnostic message. */
  envValue: string;
}

export function detectNestedAgent(
  env: NodeJS.ProcessEnv = process.env,
): NestedAgentDetection | null {
  if (env.AMPLITUDE_WIZARD_ALLOW_NESTED === '1') return null;

  if (env.CLAUDECODE === '1') {
    return {
      signal: 'claude_code_cli',
      envVar: 'CLAUDECODE',
      envValue: '1',
    };
  }

  const entrypoint = env.CLAUDE_CODE_ENTRYPOINT;
  if (entrypoint) {
    return {
      signal: 'claude_agent_sdk',
      envVar: 'CLAUDE_CODE_ENTRYPOINT',
      envValue: entrypoint,
    };
  }

  return null;
}
