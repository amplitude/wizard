/**
 * tool-call-label — convert raw tool-call events into short, human-readable
 * "what is the wizard doing right now" lines.
 *
 * The TUI's Tasks list (RunScreen) used to be static — only the canonical
 * task name and ticking spinner. Tool calls (Read/Bash/Edit/Write/Grep/Glob/
 * MCP) ARE happening every few seconds, but they only surfaced in the Logs
 * tab. This module does the verb-form transform that powers the live
 * substep narration under the active task:
 *
 *   Read package.json          → "Reading package.json"
 *   Bash pnpm add @amplitude/… → "Running `pnpm add @amplitude/…`"
 *   Edit src/app/page.tsx      → "Editing src/app/page.tsx"
 *   Grep "track\("            → "Searching for `track\(`"
 *   mcp__amplitude__create_chart → "Calling Amplitude create_chart"
 *
 * Pure — no I/O, no React. Safe to call inside render or from a hook.
 */

import path from 'node:path';

/**
 * Maximum length of the rendered label. Tool-call summaries can be the full
 * Bash command (we cap at 50 chars in the Bash branch already) plus a verb
 * prefix; this final cap is a belt-and-braces guard so a wide terminal
 * doesn't show a 200-char shell pipeline that wraps and breaks alignment.
 */
const MAX_LABEL_LENGTH = 80;

/** Truncate `s` with a single-character ellipsis when it exceeds `max`. */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  // Reserve one char for the ellipsis so the final string is exactly `max`
  // long. Shrinking by 1 protects against double-truncation drift.
  return s.slice(0, max - 1) + '…';
}

/**
 * Relativize an absolute path against `installDir` for display. Same shape
 * as `displayPath` in FileWritesPanel — keeps the substep label compact
 * (`src/index.ts` instead of `/Users/.../project/src/index.ts`).
 */
function shortPath(raw: string, installDir?: string): string {
  if (!raw) return raw;
  if (
    installDir &&
    raw.startsWith(installDir) &&
    (raw.length === installDir.length || raw[installDir.length] === '/')
  ) {
    const rel = path.relative(installDir, raw);
    return rel === '' ? path.basename(raw) : rel;
  }
  // Long absolute paths outside the project root: fall back to basename so
  // the label stays readable.
  if (raw.startsWith('/') && raw.length > 40) return path.basename(raw);
  return raw;
}

/**
 * Strip the `mcp__<server>__` prefix the SDK reports for MCP tools so the
 * label can show just the server + tool name. Falls back to the raw name
 * when no prefix matches.
 */
function parseMcpToolName(
  toolName: string,
): { server: string; bare: string } | null {
  const m = toolName.match(/^mcp__([a-z0-9_-]+)__(.+)$/i);
  if (!m) return null;
  return { server: m[1], bare: m[2] };
}

/**
 * Compress a Bash command to a short scannable head: drop leading
 * environment variables (`FOO=bar pnpm add …`), keep the verb + first arg,
 * and truncate. The agent runs long pipelines for skill installs (`mkdir
 * -p … && cp -r …`); showing the first 50 chars is enough for users to
 * orient without flooding the substep area.
 */
function shortBashCommand(command: string): string {
  const stripped = command.trim();
  if (!stripped) return command;
  return truncate(stripped, 50);
}

export interface FormatToolCallInput {
  toolName: string;
  /** Sanitized summary from `summarizeToolInput` (file path / command head / pattern / etc.). */
  summary?: string;
  /** Project install dir — used to relativize paths so labels stay short. */
  installDir?: string;
}

/**
 * Convert a tool-call event into a single-line user-facing label. Returns
 * `null` for tools the substep panel intentionally skips:
 *
 *   - `TodoWrite` — already drives the task list itself; redundant noise.
 *   - `Task` (sub-agents) — the inner agent's own narration carries this.
 *   - Unknown tools with no summary — we'd render a useless "Doing X" row.
 */
export function formatToolCallLabel(input: FormatToolCallInput): string | null {
  const { toolName, summary, installDir } = input;

  // Skip noisy tools that don't represent user-visible "doing" moments.
  if (toolName === 'TodoWrite') return null;

  // Standard Claude tools — verb-form transform.
  switch (toolName) {
    case 'Read':
      return summary
        ? truncate(
            `Reading ${shortPath(summary, installDir)}`,
            MAX_LABEL_LENGTH,
          )
        : 'Reading file';
    case 'Edit':
    case 'MultiEdit':
      return summary
        ? truncate(
            `Editing ${shortPath(summary, installDir)}`,
            MAX_LABEL_LENGTH,
          )
        : 'Editing file';
    case 'Write':
      return summary
        ? truncate(
            `Writing ${shortPath(summary, installDir)}`,
            MAX_LABEL_LENGTH,
          )
        : 'Writing file';
    case 'NotebookEdit':
      return summary
        ? truncate(
            `Editing notebook ${shortPath(summary, installDir)}`,
            MAX_LABEL_LENGTH,
          )
        : 'Editing notebook';
    case 'Bash':
      return summary
        ? truncate(`Running ${shortBashCommand(summary)}`, MAX_LABEL_LENGTH)
        : 'Running command';
    case 'Grep':
      return summary
        ? truncate(`Searching for ${summary}`, MAX_LABEL_LENGTH)
        : 'Searching code';
    case 'Glob':
      return summary
        ? truncate(`Finding ${summary}`, MAX_LABEL_LENGTH)
        : 'Finding files';
    case 'WebFetch':
    case 'WebSearch':
      return summary
        ? truncate(`Fetching ${summary}`, MAX_LABEL_LENGTH)
        : 'Fetching web content';
    case 'Task':
      // Sub-agent dispatch — the parent agent's TodoWrite already covers
      // this from the user's perspective. Skip.
      return null;
  }

  // MCP tools — show server + bare tool name. Wizard-tools is sub-second
  // and would just churn (env reads, package-manager detection); skip it
  // unless we're surfacing a confirm_event_plan moment, which the journey
  // classifier already handles.
  const mcp = parseMcpToolName(toolName);
  if (mcp) {
    if (/wizard/i.test(mcp.server)) {
      // Don't surface `wizard-tools` calls — they're plumbing, not progress.
      return null;
    }
    if (/amplitude/i.test(mcp.server)) {
      return truncate(`Calling Amplitude ${mcp.bare}`, MAX_LABEL_LENGTH);
    }
    return truncate(`Calling ${mcp.bare}`, MAX_LABEL_LENGTH);
  }

  // Unknown tool with a summary — render as "Running <toolName>" so users
  // see SOMETHING. Without a summary we drop it (saves render space).
  if (!summary) return null;
  return truncate(`${toolName}: ${summary}`, MAX_LABEL_LENGTH);
}
