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
 *
 * Layout invariants (see also __tests__/FileWritesPanel.test.tsx):
 *   - Every row is exactly 1 visual line at every terminal width.
 *   - The keyword cell (CREATE / MODIFY / DELETE) is pinned to a fixed
 *     7-column box with `flexShrink={0}` so Yoga can never steal a
 *     character from it. Without that pin, long paths trigger reflow
 *     where the keyword loses its trailing column ("CREAT…") and the
 *     space between keyword and path collapses ("MODIFYsrc/app/…").
 *   - The trailing detail cell (` · edited Xms`, ` · 788 bytes · 4ms`)
 *     is also `flexShrink={0}` so it stays glued to the row.
 *   - The path cell is the only `flexShrink={1}` cell and absorbs
 *     overflow via head-truncation (`…/[product]/page.tsx`) — never
 *     wrapping onto a second line.
 */

import { Box, Text } from 'ink';
import { useMemo, type ReactElement } from 'react';
import path from 'path';
import { Colors, Icons } from '../styles.js';
import { BrailleSpinner } from './BrailleSpinner.js';
import type { FileWriteEntry } from '../store.js';

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
  /**
   * Visible terminal width in columns. Used to head-truncate long file
   * paths so every row stays on a single line. When omitted the panel
   * falls back to a sensible default — the cap exists so a forgotten
   * width prop still renders consistently rather than reverting to the
   * old wrap behavior. RunScreen wires this from `useStdoutDimensions`.
   */
  width?: number;
}

/**
 * Head-truncate a path so the *meaningful* tail (filename + parents)
 * survives. Long Next.js segment paths like
 * `src/app/(category-sidebar)/products/[category]/[subcategory]/[product]/page.tsx`
 * become `…/[product]/page.tsx` instead of being right-truncated into
 * `src/app/(category-sidebar)/products/[ca…` (which loses the filename).
 *
 * Walks segments from the right and stops when adding the next segment
 * would exceed `maxWidth - 1` (reserved for the leading ellipsis). If
 * even the basename overflows, falls back to middle-truncation of the
 * basename so we never wrap.
 */
export const truncatePathHead = (raw: string, maxWidth: number): string => {
  if (raw.length <= maxWidth || maxWidth <= 1) return raw;
  const segments = raw.split('/');
  const basename = segments[segments.length - 1] ?? raw;
  // Basename alone overflows — middle-truncate it. Keeping the file
  // extension visible is the priority.
  if (basename.length > maxWidth) {
    if (maxWidth <= 3) return '…';
    const keep = maxWidth - 1; // reserve 1 col for the ellipsis
    const head = Math.ceil(keep / 2);
    const tail = keep - head;
    return `…${basename.slice(0, head)}…${basename.slice(-tail)}`.slice(
      0,
      maxWidth,
    );
  }
  let acc = basename;
  for (let i = segments.length - 2; i >= 0; i--) {
    const next = `${segments[i]}/${acc}`;
    // +2 for the leading `…/` prefix. Stop one segment short.
    if (next.length + 2 > maxWidth) break;
    acc = next;
  }
  if (acc === basename) return basename;
  return `…/${acc}`;
};

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
const dedupeByPath = (
  entries: readonly FileWriteEntry[],
): DedupedFileWrite[] => {
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
 */
const displayPath = (raw: string, installDir?: string): string => {
  if (
    installDir &&
    raw.startsWith(installDir) &&
    (raw.length === installDir.length || raw[installDir.length] === '/')
  ) {
    const rel = path.relative(installDir, raw);
    return rel === '' ? path.basename(raw) : rel;
  }
  return raw.startsWith('/') ? path.basename(raw) : raw;
};

export const FileWritesPanel = ({
  entries,
  installDir,
  spinnerFrame,
  now = Date.now(),
  maxVisible = 8,
  width,
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
          width={width}
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
  /** Visible width budget for the row (terminal cols). */
  width?: number;
}

/**
 * Per-row column budget. The keyword cell is pinned to 7 cells —
 * `MODIFY` is 6 chars + 1 trailing space — so Yoga cannot truncate it
 * to "CREAT" when a long path tries to claim its column. Width 7 is
 * `max('CREATE', 'MODIFY', 'DELETE') + 1`.
 */
const KEYWORD_WIDTH = 7;
/** Leading indent (' ' before icon) + status icon + space. */
const ICON_WIDTH = 3;
/** The keyword box width already includes a trailing space (width 7 for
 *  a max-6-char label), so no extra gap column is needed. */
const KEYWORD_PATH_GAP = 0;
/** Separator between path and trailing detail (` · `). */
const SEPARATOR = ' · ';
/** Floor on usable columns when the terminal is unreasonably narrow. */
const MIN_ROW_WIDTH = 24;
/** Minimum path budget — below this the row would be unreadable. */
const MIN_PATH_WIDTH = 8;
/** Default width when no measurement is available (matches Layout.maxWidth). */
const DEFAULT_ROW_WIDTH = 120;

const FileWriteRow = ({
  entry,
  editCount,
  installDir,
  spinnerFrame,
  now,
  width,
}: FileWriteRowProps) => {
  const { operation, status } = entry;
  const opLabel = OP_LABELS[operation];
  const opColor = OP_COLORS[operation];
  const rawDisplay = displayPath(entry.path, installDir);

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
  // (instead of a dead spinner). On apply we show bytes/lines + total
  // duration so the user can see throughput. When the same path was
  // touched more than once, suffix the size hint with `× N` so the
  // user sees both the latest result and the fact that the agent
  // revisited the file.
  let detail: string;
  if (status === 'applied') {
    const dur =
      entry.completedAt !== undefined
        ? formatDuration(entry.completedAt - entry.startedAt)
        : '';
    const sizeHint =
      typeof entry.bytes === 'number'
        ? `${entry.bytes.toLocaleString()} bytes`
        : 'edited';
    const sizeHintWithCount =
      editCount > 1 ? `${sizeHint} ${editCount}×` : sizeHint;
    detail = dur ? `${sizeHintWithCount} ${dur}` : sizeHintWithCount;
  } else if (status === 'failed') {
    detail = editCount > 1 ? `failed ${editCount}×` : 'failed';
  } else {
    const elapsed = now - entry.startedAt;
    const base =
      elapsed >= 1000
        ? `generating… ${formatDuration(elapsed)}`
        : 'generating…';
    detail = editCount > 1 ? `${base} ${editCount}×` : base;
  }

  // Compute the path budget so the row always fits on one line. Without
  // this, a long path makes Yoga's flex container reflow into a 2-line
  // layout where the trailing "· edited Xms" jumps to the next row,
  // misaligned far to the right. Worse, the wrap also chews characters
  // off the keyword cell (`CREAT` instead of `CREATE`) and collapses
  // the keyword/path gap (`MODIFYsrc/app/…`). Pinning every cell except
  // the path with `flexShrink={0}` and pre-truncating the path prevents
  // both classes of bug.
  const totalWidth = Math.max(MIN_ROW_WIDTH, width ?? DEFAULT_ROW_WIDTH);
  const fixedCols =
    ICON_WIDTH +
    KEYWORD_WIDTH +
    KEYWORD_PATH_GAP +
    SEPARATOR.length +
    detail.length;
  const pathBudget = Math.max(MIN_PATH_WIDTH, totalWidth - fixedCols);
  const display = truncatePathHead(rawDisplay, pathBudget);

  return (
    // Row is a single flex container. Every cell except the path pins
    // its width with `flexShrink={0}`; the path absorbs overflow via
    // head-truncation. This is the contract the test suite locks down.
    <Box flexDirection="row">
      {/* Indent + status icon + trailing space. Pinned to 3 cols so a
          narrow terminal can't collapse the icon into the keyword. */}
      <Box flexShrink={0} width={ICON_WIDTH}>
        <Text> </Text>
        {icon}
        <Text> </Text>
      </Box>
      {/* Keyword cell — pinned to 7 cols so `MODIFY` + 1 trailing space
          fits regardless of viewport. Without `flexShrink={0}` Yoga
          truncates `CREATE` to `CREAT` when the path tries to overflow. */}
      <Box flexShrink={0} width={KEYWORD_WIDTH}>
        <Text color={opColor} bold>
          {opLabel}
        </Text>
      </Box>
      {/* Path cell — the only flexible column. Pre-truncated against
          `pathBudget` so even a 90-char Next.js segment path renders on
          one line. `flexShrink={1}` lets Yoga still finalize the layout
          if our budget is off by a column. `wrap="truncate-end"` on the
          inner `<Text>` is the safety net: if the width prop disagrees
          with the actual frame width (rare, but `useStdoutDimensions`
          can lag a resize event by a frame), Ink will hard-truncate
          rather than wrap onto a second line. */}
      <Box flexShrink={1} flexGrow={1} overflow="hidden">
        <Text color={Colors.body} wrap="truncate-end">
          {display}
        </Text>
      </Box>
      {/* Trailing detail (` · edited Xms`). Pinned so the keyword/path
          can't push it onto a second line. */}
      <Box flexShrink={0}>
        <Text color={Colors.subtle}>{SEPARATOR}</Text>
        <Text color={Colors.muted}>{detail}</Text>
      </Box>
    </Box>
  );
};
