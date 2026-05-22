/**
 * RunTimelineLedger — receipts ledger for the redesigned RunScreen.
 *
 * Renders the most recent file writes as one row per file. Format:
 *
 *   ✎ src/app/layout.tsx               +12  −0   · 240ms
 *
 * Width-responsive caps come from the composer:
 *
 *   cols >= 100  →  last 5 rows
 *   cols >=  60  →  last 3 rows
 *   cols <   60  →  last 2 rows
 *
 * Paths are head-truncated against the visible width budget so each row
 * stays on a single line.
 *
 * ASCII fallback uses `~` for the edit glyph and `+X -Y` for diff
 * counts (no en-dash).
 */

import { Box, Text } from 'ink';
import { useMemo } from 'react';
import { Colors } from '../styles.js';
import type { FileWriteEntry } from '../store.js';
import { displayPath } from '../utils/display-path.js';
import { truncatePathHead } from './FileWritesPanel.js';
import { getFileChangeLedger } from '../../../lib/file-change-ledger.js';
import { summarizeLedgerPath } from '../../../lib/file-change-diff.js';

interface RunTimelineLedgerProps {
  entries: readonly FileWriteEntry[];
  installDir?: string;
  /** Maximum rows to render (default 5). */
  max?: number;
  /** Terminal column count — used for path head-truncation. */
  cols: number;
  /** ASCII fallback. */
  ascii?: boolean;
}

interface LedgerRow {
  path: string;
  added: number;
  removed: number;
  durMs: number | null;
  status: FileWriteEntry['status'];
}

const formatDuration = (ms: number | null): string => {
  if (ms === null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const buildRow = (entry: FileWriteEntry): LedgerRow => {
  let added = 0;
  let removed = 0;
  if (entry.status === 'applied') {
    try {
      const summary = summarizeLedgerPath(getFileChangeLedger(), entry.path, {
        includePatch: false,
      });
      if (summary) {
        added = summary.additions;
        removed = summary.deletions;
      }
    } catch {
      // Ledger not available (test fixture, race) — fall back to zero
      // counts. The duration column is still meaningful.
    }
  }
  const durMs =
    entry.completedAt !== undefined ? entry.completedAt - entry.startedAt : null;
  return { path: entry.path, added, removed, durMs, status: entry.status };
};

export const RunTimelineLedger = ({
  entries,
  installDir,
  max = 5,
  cols,
  ascii = false,
}: RunTimelineLedgerProps) => {
  // Dedupe by path and keep latest emission per file. The shared
  // FileWritesPanel uses the same strategy; we deliberately reimplement
  // the cheap version here so the ledger row count is stable when the
  // agent re-edits the same file multiple times.
  const rows: LedgerRow[] = useMemo(() => {
    const byPath = new Map<string, FileWriteEntry>();
    for (const entry of entries) {
      const prev = byPath.get(entry.path);
      if (!prev || entry.startedAt >= prev.startedAt) {
        byPath.set(entry.path, entry);
      }
    }
    const ordered = Array.from(byPath.values()).sort(
      (a, b) => a.startedAt - b.startedAt,
    );
    return ordered.map(buildRow);
  }, [entries]);

  if (rows.length === 0) return null;

  const visible = rows.slice(Math.max(0, rows.length - max));

  // Path budget — reserve space for the leading glyph (2 cells) and the
  // trailing "+X -Y · NNNms" detail column (we approximate at 18 cells,
  // enough for typical 3-digit diff counts).
  const DETAIL_BUDGET = 20;
  const GLYPH_BUDGET = 2;
  const pathBudget = Math.max(10, cols - GLYPH_BUDGET - DETAIL_BUDGET - 4);

  const editGlyph = ascii ? '~' : '✎';
  const minusGlyph = ascii ? '-' : '−';

  return (
    <Box flexDirection="column">
      {visible.map((row, i) => {
        const rel = displayPath(row.path, installDir);
        const truncated = truncatePathHead(rel, pathBudget);
        const detailParts: string[] = [];
        if (row.status === 'applied') {
          detailParts.push(`+${row.added}`);
          detailParts.push(`${minusGlyph}${row.removed}`);
        } else if (row.status === 'failed') {
          detailParts.push('failed');
        } else {
          detailParts.push('writing…');
        }
        const dur = formatDuration(row.durMs);
        const detail = dur
          ? `${detailParts.join(' ')} · ${dur}`
          : detailParts.join(' ');
        return (
          <Box key={`${i}-${row.path}`} flexDirection="row">
            <Text color={Colors.muted}>{editGlyph} </Text>
            <Box flexShrink={1} flexGrow={1} overflow="hidden">
              <Text color={Colors.body} wrap="truncate-end">
                {truncated}
              </Text>
            </Box>
            <Box flexShrink={0}>
              <Text color={Colors.muted}> {detail}</Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};
