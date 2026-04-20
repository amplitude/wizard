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

// Prefix-based matching so a future SDK release adding a new `CLAUDE_CODE_*`
// or `CLAUDE_AGENT_SDK_*` marker gets stripped automatically. Hand-maintained
// allowlists rot; the bug we fixed would come back silently.
const NESTED_ENV_PREFIXES = ['CLAUDE_CODE_', 'CLAUDE_AGENT_SDK_'];

// Exact-match keys that don't fit the prefix rule.
const NESTED_ENV_EXACT = new Set(['CLAUDECODE', 'DEBUG_CLAUDE_AGENT_SDK']);

function isNestedEnvKey(key: string): boolean {
  if (NESTED_ENV_EXACT.has(key)) return true;
  return NESTED_ENV_PREFIXES.some((p) => key.startsWith(p));
}

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
 *   - `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` — managed by
 *     `initializeAgent` (set on gateway path, cleared on non-gateway paths)
 */
export function sanitizeNestedClaudeEnv(
  env: NodeJS.ProcessEnv = process.env,
): SanitizeResult {
  const cleared: string[] = [];
  for (const key of Object.keys(env)) {
    if (isNestedEnvKey(key) && env[key] !== undefined) {
      delete env[key];
      cleared.push(key);
    }
  }
  return { cleared };
}
