/**
 * RunTimelineLedger — last-N file write rows inside the new
 * `RunTimeline` composer (PR 4 of the Timeline UX redesign).
 *
 * Renders rows like:
 *
 *   ✎ src/amplitude.ts +42 −0
 *   ✎ app/layout.tsx   +3 −1
 *
 * Paths are head-truncated (`…/long/path`) so each row stays on a
 * single line regardless of terminal width. ASCII mode swaps the
 * pencil glyph for an asterisk so we render correctly under TERM=dumb
 * / non-UTF locales.
 *
 * The +/- counts come from the file-change ledger when available; we
 * fall back to a bytes count if the diff hasn't been recorded yet.
 *
 * Like `RunTimelineTodos`, this component is presentational — slicing
 * is the parent's responsibility.
 */

import { Box, Text } from 'ink';
import { Colors } from '../styles.js';
import type { FileWriteEntry } from '../store.js';
import { displayPath } from '../utils/display-path.js';
import { getFileChangeLedger } from '../../../lib/file-change-ledger.js';
import { summarizeLedgerPath } from '../../../lib/file-change-diff.js';

export interface RunTimelineLedgerProps {
  /** File writes already sliced to the desired length by the parent. */
  entries: readonly FileWriteEntry[];
  /** Project install dir — used to relativize paths. */
  installDir?: string;
  /** Visible terminal width; used to head-truncate long paths. */
  width: number;
  /** Whether to render unicode glyphs (true) or ascii fallbacks (false). */
  unicode: boolean;
}

/**
 * Head-truncate a path to fit a column budget, keeping the tail
 * (filename) intact so the user sees "what" before "where". Borrowed
 * from FileWritesPanel's behavior; copied locally to avoid coupling
 * the two components' internals.
 */
function truncatePath(path: string, maxLen: number): string {
  if (path.length <= maxLen) return path;
  if (maxLen <= 1) return path.slice(-maxLen);
  return '…' + path.slice(-(maxLen - 1));
}

function statusColor(status: FileWriteEntry['status']): string {
  if (status === 'applied') return Colors.success;
  if (status === 'failed') return Colors.error;
  return Colors.active;
}

function glyphFor(unicode: boolean): string {
  return unicode ? '✎' : '*';
}

/** Return `+X −Y` (or fallback) for an entry. */
function summaryFor(entry: FileWriteEntry): string {
  // Try the lib ledger first — it carries per-file +/− line deltas via
  // jsdiff. Otherwise fall back to a bytes hint, then to the operation
  // keyword. Never throw: the timeline must not crash a run.
  try {
    const ledger = getFileChangeLedger();
    const diff = summarizeLedgerPath(ledger, entry.path, {
      includePatch: false,
    });
    if (diff && (diff.additions > 0 || diff.deletions > 0)) {
      return `+${diff.additions} −${diff.deletions}`;
    }
  } catch {
    // Defensive — fall through.
  }
  if (entry.bytes !== undefined) return `${entry.bytes}B`;
  return entry.operation;
}

export const RunTimelineLedger = ({
  entries,
  installDir,
  width,
  unicode,
}: RunTimelineLedgerProps) => {
  if (entries.length === 0) return null;

  // Reserve some columns for the glyph + summary. Anything beyond that
  // belongs to the path, head-truncated.
  const reserved = 16; // glyph + space + summary + breathing room
  const pathBudget = Math.max(10, width - reserved);

  return (
    <Box flexDirection="column">
      {entries.map((entry, idx) => {
        const rel = displayPath(entry.path, installDir);
        const trimmed = truncatePath(rel, pathBudget);
        const summary = summaryFor(entry);
        return (
          <Box key={`${idx}-${entry.path}`}>
            <Text color={statusColor(entry.status)}>{glyphFor(unicode)} </Text>
            <Text color={Colors.body}>{trimmed}</Text>
            <Text color={Colors.muted}> {summary}</Text>
          </Box>
        );
      })}
    </Box>
  );
};
