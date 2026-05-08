/**
 * FileWritesPanel — live per-file activity from the inner agent.
 *
 * Renders one row per file the inner agent's Edit / Write / MultiEdit /
 * NotebookEdit tools have touched during the run. Rows are populated by
 * `WizardStore.recordFileChangePlanned` / `recordFileChangeApplied`,
 * which `inner-lifecycle.ts` calls from PreToolUse / PostToolUse via the
 * abstract `WizardUI` interface.
 *
 * UX:
 *   ⠸  CREATE   src/amplitude.ts            generating...
 *   ✓  CREATE   src/events.ts               42 lines    1.2s
 *   ✓  MODIFY   app/layout.tsx              edited      0.3s
 *   ✓  MODIFY   src/share/ShareDialog.tsx   edited 2×   0.3s
 *   ✗  MODIFY   .env.local                  failed
 *
 * Color tokens (see styles.ts):
 *   - CREATE → success (emerald)
 *   - MODIFY → warning (amber)
 *   - DELETE → error (red)
 *   - in-progress rows lean on Colors.active (violet) for the spinner
 *
 * **Dedupe contract.** The store appends one entry per emission — when
 * the agent edits the same file 4 times we receive 4 entries for that
 * path. The panel collapses these into a single row keyed on `path`,
 * showing the LATEST entry's status / duration / bytes. When more than
 * one emission landed for a path we annotate the row with `× N`. Most
 * recent emission wins for ordering; stable insertion order otherwise.
 *
 * Hidden when there are no rows so RunScreen stays compact during the
 * planning phase before any file write has fired.
 */

import { Box, Text } from 'ink';
import { useMemo, type ReactElement } from 'react';
import path from 'path';
import { Colors, Icons } from '../styles.js';
import { BrailleSpinner } from './BrailleSpinner.js';
import type { FileWriteEntry } from '../store.js';
import { getFileChangeLedger } from '../../../lib/file-change-ledger.js';
import { summarizeLedgerPath } from '../../../lib/file-change-diff.js';

/**
 * Per-path aggregation produced by `dedupeByPath` below. Carries the
 * latest entry plus the total number of emissions seen for that path so
 * the row can render `edited 3×`.
 */
interface DedupedFileWrite {
  entry: FileWriteEntry;
  editCount: number;
}

interface FileWritesPanelProps {
  entries: FileWriteEntry[];
  /** Project install dir — used to relativize displayed paths. */
  installDir?: string;
  /** Shared spinner frame so all in-progress rows tick together. */
  spinnerFrame?: number;
  /** Wall-clock ms used to compute elapsed time on in-progress rows. */
  now?: number;
  /** Cap on rows rendered — older rows are dropped from the head. */
  maxVisible?: number;
}

const OP_LABELS: Record<FileWriteEntry['operation'], string> = {
  create: 'CREATE',
  modify: 'MODIFY',
  delete: 'DELETE',
};

const OP_COLORS: Record<FileWriteEntry['operation'], string> = {
  create: Colors.success,
  modify: Colors.warning,
  delete: Colors.error,
};

/** Right-pad to a fixed width with ASCII spaces. */
const padRight = (s: string, width: number): string =>
  s.length >= width ? s : s + ' '.repeat(width - s.length);

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

/**
 * Collapse repeated emissions for the same path into a single row.
 *
 * The store keeps an append-only list — every PreToolUse / PostToolUse
 * pair adds an entry, even when the inner agent edits the same file
 * multiple times. Rendering that list verbatim produces the duplicate
 * rows the user complained about ("oh god look how bad this is" — see
 * PR description).
 *
 * Strategy: walk the list once, keying by `path`. For each path keep the
 * MOST RECENT entry (latest `startedAt` wins) and count how many times
 * we saw it. Order the result by latest emission so the row order in
 * the panel still matches the order the agent finished writing —
 * preserves the "most recent activity at the bottom" feel without
 * leaving stale duplicates above it.
 *
 * Path is used as-is; the inner agent normalizes to absolute paths
 * before emitting, so two emissions for the same file always carry the
 * same string. Display-time relativization happens in `displayPath`
 * downstream.
 */
const dedupeByPath = (entries: readonly FileWriteEntry[]): DedupedFileWrite[] => {
  const byPath = new Map<string, DedupedFileWrite>();
  for (const entry of entries) {
    const prev = byPath.get(entry.path);
    if (!prev) {
      byPath.set(entry.path, { entry, editCount: 1 });
      continue;
    }
    // Latest emission wins. Strict `>=` would also work but `>` keeps
    // the first occurrence at a tie, which matches insertion order
    // when timestamps collide (synthetic test fixtures, sub-ms writes).
    const latest = entry.startedAt > prev.entry.startedAt ? entry : prev.entry;
    byPath.set(entry.path, {
      entry: latest,
      editCount: prev.editCount + 1,
    });
  }
  // Sort by latest emission's startedAt so the most recent activity
  // sits at the bottom — same ordering the panel had before dedupe.
  return Array.from(byPath.values()).sort(
    (a, b) => a.entry.startedAt - b.entry.startedAt,
  );
};

/**
 * Relativize an absolute path against the install dir for display. Falls
 * back to the basename if the path lives outside the project (rare, but
 * possible — skill installs sometimes touch tmp dirs).
 *
 * Uses `path.sep` rather than a hardcoded `/` so the boundary check works
 * on Windows (where ledger paths use `\`).
 */
const displayPath = (raw: string, installDir?: string): string => {
  if (
    installDir &&
    raw.startsWith(installDir) &&
    (raw.length === installDir.length || raw[installDir.length] === path.sep)
  ) {
    const rel = path.relative(installDir, raw);
    return rel === '' ? path.basename(raw) : rel;
  }
  return path.isAbsolute(raw) ? path.basename(raw) : raw;
};

export const FileWritesPanel = ({
  entries,
  installDir,
  spinnerFrame,
  now = Date.now(),
  maxVisible = 8,
}: FileWritesPanelProps) => {
  // Dedupe by path FIRST, then slice to maxVisible. Slicing first would
  // drop different-path entries to make room for duplicates — we want
  // the inverse: collapse duplicates of the same file, then keep the
  // most recent N distinct files.
  const dedupedAll = useMemo(() => dedupeByPath(entries), [entries]);

  const visible = useMemo(
    () =>
      dedupedAll.length > maxVisible
        ? dedupedAll.slice(dedupedAll.length - maxVisible)
        : dedupedAll,
    [dedupedAll, maxVisible],
  );

  if (visible.length === 0) return null;

  // Header counters reflect the deduped view too — "14 written" reading
  // off raw emissions is exactly the bug screenshot.
  const completedCount = dedupedAll.filter(
    (d) => d.entry.status === 'applied',
  ).length;
  const totalCount = dedupedAll.length;
  const inProgressCount = dedupedAll.filter(
    (d) => d.entry.status === 'planned',
  ).length;

  return (
    // Bold section header is the visual separator — no blank row above.
    // Stacking marginTop={1} on every section in RunScreen produced 5–6
    // dead rows of vertical whitespace and made the dashboard hard to scan.
    <Box flexDirection="column">
      <Box>
        <Text color={Colors.heading} bold>
          Files
        </Text>
        <Text color={Colors.subtle}> {Icons.dot} </Text>
        <Text color={Colors.muted}>
          {inProgressCount > 0
            ? `${completedCount}/${totalCount} written`
            : `${totalCount} written`}
        </Text>
        {/* Discoverability hint for the /diff slash command — addresses the
            user's "what actually changed?" question right at the moment
            they're watching files fly by. Only surfaces once at least one
            write has applied so we don't spam the hint mid-planning. */}
        {completedCount > 0 && (
          <>
            <Text color={Colors.subtle}> {Icons.dot} </Text>
            <Text color={Colors.muted}>
              type <Text color={Colors.accent}>/diff</Text> to review
            </Text>
          </>
        )}
      </Box>
      {visible.map(({ entry, editCount }) => (
        <FileWriteRow
          // Key on path — entries are deduped, so path is unique within
          // the rendered list and stable across re-renders even when the
          // latest entry's startedAt shifts.
          key={entry.path}
          entry={entry}
          editCount={editCount}
          installDir={installDir}
          spinnerFrame={spinnerFrame}
          now={now}
        />
      ))}
    </Box>
  );
};

interface FileWriteRowProps {
  entry: FileWriteEntry;
  /**
   * Total emissions for this path across the run. >1 when the agent
   * edited the same file multiple times — annotated as `× N` in the
   * detail column. 1 when the file was written exactly once.
   */
  editCount: number;
  installDir?: string;
  spinnerFrame?: number;
  now: number;
}

const FileWriteRow = ({
  entry,
  editCount,
  installDir,
  spinnerFrame,
  now,
}: FileWriteRowProps) => {
  const { operation, status } = entry;
  const opLabel = padRight(OP_LABELS[operation], 6);
  const opColor = OP_COLORS[operation];
  const display = displayPath(entry.path, installDir);

  let icon: ReactElement;
  if (status === 'applied') {
    icon = <Text color={Colors.success}>{Icons.checkmark}</Text>;
  } else if (status === 'failed') {
    icon = <Text color={Colors.error}>{Icons.cross}</Text>;
  } else {
    icon = <BrailleSpinner color={Colors.active} frame={spinnerFrame} />;
  }

  // Trailing detail column. While the row is still planned we show
  // "generating…" with elapsed seconds so a stuck write is visible
  // (instead of a dead spinner). On apply we prefer the +N/-M diff
  // counts from the FileChangeLedger (per-write toast surface — see
  // user request) and fall back to bytes/lines if the ledger has no
  // record (binary file, capture race, etc.). When the same path was
  // touched more than once, suffix the size hint with `× N` so the
  // user sees both the latest result and the fact that the agent
  // revisited the file.
  //
  // The diff summary is computed via `structuredPatch` + `createPatch`
  // — expensive enough that we MUST NOT re-run it on every spinner
  // tick. Memoize on (path, completedAt) so the row only diffs once
  // per applied write. While `status !== 'applied'`, getDiff isn't
  // called at all (the memo dep keeps the result `null`).
  // We deliberately key on `completedAt` so a re-applied write (rare,
  // but the ledger supports it) re-computes the summary.
  const diffSummary = useMemo(() => {
    if (status !== 'applied') return null;
    try {
      // `includePatch: false` — the row only renders +N/-M counts, never
      // the unified patch body, so paying the second `createPatch` pass
      // would be pure waste.
      return summarizeLedgerPath(getFileChangeLedger(), entry.path, {
        includePatch: false,
      });
    } catch {
      return null;
    }
  }, [status, entry.path, entry.completedAt]);

  let detail: string;
  if (status === 'applied') {
    const dur =
      entry.completedAt !== undefined
        ? formatDuration(entry.completedAt - entry.startedAt)
        : '';
    let sizeHint: string;
    if (
      diffSummary &&
      (diffSummary.additions > 0 || diffSummary.deletions > 0)
    ) {
      sizeHint = `+${diffSummary.additions}/-${diffSummary.deletions}`;
    } else if (typeof entry.bytes === 'number') {
      sizeHint = `${entry.bytes.toLocaleString()} bytes`;
    } else {
      sizeHint = 'edited';
    }
    const sizeHintWithCount =
      editCount > 1 ? `${sizeHint} ${editCount}×` : sizeHint;
    detail = dur ? `${sizeHintWithCount}  ${dur}` : sizeHintWithCount;
  } else if (status === 'failed') {
    detail = editCount > 1 ? `failed ${editCount}×` : 'failed';
  } else {
    const elapsed = now - entry.startedAt;
    const base =
      elapsed >= 1000 ? `generating… ${formatDuration(elapsed)}` : 'generating…';
    detail = editCount > 1 ? `${base} ${editCount}×` : base;
  }

  return (
    <Box>
      <Text> {/* leading indent so rows align with the section header */}</Text>
      {icon}
      <Text> </Text>
      <Text color={opColor} bold>
        {opLabel}
      </Text>
      <Text> </Text>
      <Text color={Colors.body} wrap="truncate-end">
        {display}
      </Text>
      <Text color={Colors.subtle}> {Icons.dot} </Text>
      <Text color={Colors.muted}>{detail}</Text>
    </Box>
  );
};
