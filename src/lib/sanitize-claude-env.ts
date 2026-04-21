/**
 * Strips env vars inherited from an outer Claude Code / Claude Agent SDK
 * session so the wizard's own SDK subprocess starts clean.
 *
 * When `npx @amplitude/wizard` runs inside a Claude Code terminal, Node
 * inherits the outer session's env: `CLAUDECODE=1`, `CLAUDE_CODE_ENTRYPOINT`,
 * `CLAUDE_CODE_OAUTH_TOKEN`, etc. When we then call `@anthropic-ai/claude-agent-sdk`
 * to drive the setup agent, the inner SDK sees those signals and routes
 * auth/headers as if it were still a child of the outer session — which
 * 400s at our LLM gateway.
 *
 * Removing these vars before the inner SDK boots makes it behave like a
 * fresh top-level run.
 *
 * This is destructive (mutates `process.env`), intentional, and idempotent.
 */

const NESTED_ENV_VARS = [
  // Claude Code CLI markers
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_CODE_ENABLE_TASKS',
  'CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_DEBUG_LOGS_DIR',
  // Claude Agent SDK markers
  'CLAUDE_AGENT_SDK_VERSION',
  'DEBUG_CLAUDE_AGENT_SDK',
  // Inherited OAuth — agent-interface sets its own after sanitizing,
  // so this is always safe to clear.
  'CLAUDE_CODE_OAUTH_TOKEN',
];

export interface SanitizeResult {
  cleared: string[];
}

/**
 * Remove inherited Claude Code / Claude Agent SDK env vars from
 * `process.env` (or the provided object, for tests).
 *
 * Returns the list of keys that were actually present and removed.
 * Pure w.r.t. vars that weren't set — no-op for them.
 *
 * Does NOT touch:
 *   - `ANTHROPIC_API_KEY` — user-intent, handled by `initializeAgent`
 *   - `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` — overwritten by
 *     `initializeAgent` immediately after this call
 */
export function sanitizeNestedClaudeEnv(
  env: NodeJS.ProcessEnv = process.env,
): SanitizeResult {
  const cleared: string[] = [];
  for (const key of NESTED_ENV_VARS) {
    if (env[key] !== undefined) {
      delete env[key];
      cleared.push(key);
    }
  }
  return { cleared };
}
