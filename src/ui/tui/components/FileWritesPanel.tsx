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
 *   ✗  MODIFY   .env.local                  failed
 *
 * Color tokens (see styles.ts):
 *   - CREATE → success (emerald)
 *   - MODIFY → warning (amber)
 *   - DELETE → error (red)
 *   - in-progress rows lean on Colors.active (violet) for the spinner
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
   * Visible terminal width. Used to head-truncate long file paths so every
   * row stays on a single line. When omitted, the panel falls back to a
   * sensible default — the cap exists so a forgotten width prop still
   * renders consistently rather than reverting to the old wrap behavior.
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
  if (basename.length + 1 >= maxWidth) {
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
    // +1 for the leading ellipsis. Stop one segment short.
    if (next.length + 1 > maxWidth) break;
    acc = next;
  }
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

/** Right-pad to a fixed width with ASCII spaces. */
const padRight = (s: string, width: number): string =>
  s.length >= width ? s : s + ' '.repeat(width - s.length);

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
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
  // Slice to the most recent rows. The store also caps at MAX_FILE_WRITES,
  // but RunScreen has limited vertical real estate — long-running runs
  // would otherwise push the rest of the dashboard off-screen.
  const visible = useMemo(
    () =>
      entries.length > maxVisible
        ? entries.slice(entries.length - maxVisible)
        : entries,
    [entries, maxVisible],
  );

  if (visible.length === 0) return null;

  const completedCount = entries.filter((e) => e.status === 'applied').length;
  const totalCount = entries.length;
  const inProgressCount = entries.filter((e) => e.status === 'planned').length;

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
      {visible.map((entry) => (
        <FileWriteRow
          key={`${entry.startedAt}-${entry.path}`}
          entry={entry}
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
  installDir?: string;
  spinnerFrame?: number;
  now: number;
  /** Visible width budget for the row (terminal cols). */
  width?: number;
}

/**
 * Fixed glyph budget per row, in terminal columns:
 *   1 leading space + 1 status icon + 1 space + 6 op label
 *   + 1 space + path + 3 (' · ') + detail.
 *
 * We only need to budget the *non-path*, *non-detail* cells here — those
 * are the cells with predictable widths.
 */
const ROW_FIXED_COLS =
  1 /* indent */ +
  1 /* icon */ +
  1 +
  6 /* op label */ +
  1 /* gap */ +
  3; /* ' · ' */
/** Floor on usable columns when the terminal is unreasonably narrow. */
const MIN_ROW_WIDTH = 24;
/** Minimum path budget — below this the row would be unreadable. */
const MIN_PATH_WIDTH = 8;
/** Default width when no measurement is available (matches Layout.maxWidth). */
const DEFAULT_ROW_WIDTH = 120;

const FileWriteRow = ({
  entry,
  installDir,
  spinnerFrame,
  now,
  width,
}: FileWriteRowProps) => {
  const { operation, status } = entry;
  const opLabel = padRight(OP_LABELS[operation], 6);
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
  // duration so the user can see throughput.
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
    detail = dur ? `${sizeHint} ${dur}` : sizeHint;
  } else if (status === 'failed') {
    detail = 'failed';
  } else {
    const elapsed = now - entry.startedAt;
    detail =
      elapsed >= 1000
        ? `generating… ${formatDuration(elapsed)}`
        : 'generating…';
  }

  // Compute the path budget so the row always fits on one line. Without
  // this, a long path makes Yoga's flex container reflow into a 2-line
  // layout where the trailing "· edited Xms" jumps to the next row,
  // misaligned far to the right. Short paths kept their compact 1-line
  // layout — that visual inconsistency is the bug we're fixing here.
  const totalWidth = Math.max(MIN_ROW_WIDTH, width ?? DEFAULT_ROW_WIDTH);
  const pathBudget = Math.max(
    MIN_PATH_WIDTH,
    totalWidth - ROW_FIXED_COLS - detail.length,
  );
  const display = truncatePathHead(rawDisplay, pathBudget);

  return (
    <Box>
      <Text> {/* leading indent so rows align with the section header */}</Text>
      {icon}
      <Text> </Text>
      <Text color={opColor} bold>
        {opLabel}
      </Text>
      <Text> </Text>
      <Text color={Colors.body}>{display}</Text>
      <Text color={Colors.subtle}> {Icons.dot} </Text>
      <Text color={Colors.muted}>{detail}</Text>
    </Box>
  );
};
