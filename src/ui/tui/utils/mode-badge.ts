/**
 * mode-badge.ts — resolve the "current mode" badge shown in the TUI
 * header.
 *
 * Part of v2 PR 5 (TUI redesign). The brief calls for a visible mode
 * badge so the user can see at a glance whether the wizard is running
 * interactively, in `--agent` JSON mode, in `--ci`/`--yes` mode, or
 * nested inside another Claude Agent session (the bug from PR 3 where
 * a nested run silently redirected the parent agent to `/welcome`).
 *
 * Pure (env-only). Reads from `process.env` so callers don't have to
 * thread mode plumbing through the screen tree.
 */
import { detectNestedAgent } from '../../../lib/detect-nested-agent.js';
import { ModeBadge, type ModeBadgeKey } from '../styles.js';

export interface ResolvedMode {
  key: ModeBadgeKey;
  label: string;
  color: string;
}

/**
 * Resolve the current execution mode for badge display.
 *
 * Priority (first match wins):
 *   1. Nested-agent (CLAUDECODE / CLAUDE_CODE_ENTRYPOINT) — flagged
 *      so the user sees they're running inside another agent.
 *   2. Explicit `AMPLITUDE_WIZARD_AGENT_MODE=1` (set by `--agent`).
 *   3. Explicit `AMPLITUDE_WIZARD_CI=1` or `CI=true` plus `--yes`.
 *   4. MCP-server mode (`AMPLITUDE_WIZARD_MCP_SERVE=1`).
 *   5. Fallback — interactive.
 */
export function resolveMode(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedMode {
  const nested = detectNestedAgent(env);
  if (nested) {
    const m = ModeBadge['nested-agent'];
    return { key: 'nested-agent', label: m.label, color: m.color };
  }
  if (env.AMPLITUDE_WIZARD_MCP_SERVE === '1') {
    const m = ModeBadge['mcp-server'];
    return { key: 'mcp-server', label: m.label, color: m.color };
  }
  if (env.AMPLITUDE_WIZARD_AGENT_MODE === '1') {
    const m = ModeBadge.agent;
    return { key: 'agent', label: m.label, color: m.color };
  }
  if (env.AMPLITUDE_WIZARD_CI === '1' || env.CI === 'true') {
    const m = ModeBadge.ci;
    return { key: 'ci', label: m.label, color: m.color };
  }
  const m = ModeBadge.interactive;
  return { key: 'interactive', label: m.label, color: m.color };
}
