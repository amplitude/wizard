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
 * Relativize an absolute path against the install dir for display. Falls
 * back to the basename if the path lives outside the project (rare, but
 * possible — skill installs sometimes touch tmp dirs).
 */
const displayPath = (raw: string, installDir?: string): string => {
  if (installDir && raw.startsWith(installDir)) {
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
    <Box flexDirection="column" marginTop={1}>
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
}

const FileWriteRow = ({
  entry,
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
    detail = dur ? `${sizeHint}  ${dur}` : sizeHint;
  } else if (status === 'failed') {
    detail = 'failed';
  } else {
    const elapsed = now - entry.startedAt;
    detail = elapsed >= 1000 ? `generating… ${formatDuration(elapsed)}` : 'generating…';
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
