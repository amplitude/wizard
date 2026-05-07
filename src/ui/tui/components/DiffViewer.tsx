/**
 * DiffViewer — render a unified diff for one file (or a tree summary
 * for many) inside the TUI.
 *
 * Reads from the session-scoped `FileChangeLedger` (see
 * `src/lib/file-change-ledger.ts`) which captures before/after content at
 * Pre/PostToolUse. Pure presentational — does not mutate the ledger.
 *
 * Two modes:
 *   - **summary** (no `path` prop): tree of every changed file with
 *     +N/-M counts. Used by `/diff` with no argument and by the outro's
 *     "what changed" section.
 *   - **detail** (`path` prop set): unified diff for that one file with
 *     scrollable hunks. Used by `/diff <path>`.
 *
 * Color semantics:
 *   - additions  → `Colors.success` (emerald)
 *   - deletions  → `Colors.error`   (red)
 *   - hunk header → `Colors.accent`
 *   - context    → `Colors.muted`
 *
 * Keyboard nav (detail mode): j/down to scroll forward, k/up to scroll
 * back, q/esc to exit. Owned by the parent surface — DiffViewer just
 * renders the slice given by `scrollOffset`.
 */

import { Box, Text } from 'ink';
import path from 'path';
import { Colors, Icons } from '../styles.js';
import type { FileDiffSummary } from '../../../lib/file-change-diff.js';

interface DiffViewerProps {
  /** All file diffs from the ledger. */
  diffs: FileDiffSummary[];
  /** When set, render the unified diff for this single file. */
  filePath?: string;
  /** Project root used to relativize displayed paths. */
  installDir?: string;
  /** Cap on rendered patch lines in detail mode (scroll offset). */
  scrollOffset?: number;
  /** Max lines of patch body to render in detail mode. */
  maxLines?: number;
}

const OP_LABELS: Record<FileDiffSummary['operation'], string> = {
  create: 'NEW',
  modify: 'MOD',
  delete: 'DEL',
};

const OP_COLORS: Record<FileDiffSummary['operation'], string> = {
  create: Colors.success,
  modify: Colors.warning,
  delete: Colors.error,
};

const displayPath = (raw: string, installDir?: string): string => {
  if (
    installDir &&
    raw.startsWith(installDir) &&
    (raw.length === installDir.length || raw[installDir.length] === path.sep)
  ) {
    const rel = path.relative(installDir, raw);
    return rel === '' ? path.basename(raw) : rel;
  }
  return raw;
};

/**
 * Strip the `Index:` / `===` / `---` / `+++` headers that `createPatch`
 * prepends. The viewer renders its own per-file heading so those bytes
 * are pure noise. Keep the `@@` hunk markers and content lines.
 */
function stripPatchHeader(patch: string): string[] {
  const lines = patch.split('\n');
  // First hunk header is the boundary. Drop everything before it.
  const hunkStart = lines.findIndex((l) => l.startsWith('@@'));
  if (hunkStart === -1) return [];
  return lines.slice(hunkStart);
}

/** Map a single patch line to its color/prefix. Pure for snapshot tests. */
export function classifyPatchLine(
  line: string,
): { color: string; line: string } {
  if (line.startsWith('@@')) return { color: Colors.accent, line };
  if (line.startsWith('+') && !line.startsWith('+++')) {
    return { color: Colors.success, line };
  }
  if (line.startsWith('-') && !line.startsWith('---')) {
    return { color: Colors.error, line };
  }
  if (line.startsWith('\\ No newline')) {
    // jsdiff emits this trailer when a file lacks a final newline. It's
    // metadata, not content — render dimmed and small.
    return { color: Colors.subtle, line };
  }
  return { color: Colors.muted, line };
}

export function formatChangeCounts(
  additions: number,
  deletions: number,
): string {
  if (additions === 0 && deletions === 0) return 'no textual change';
  return `+${additions} / -${deletions}`;
}

export const DiffViewer = ({
  diffs,
  filePath,
  installDir,
  scrollOffset = 0,
  maxLines = 30,
}: DiffViewerProps) => {
  if (diffs.length === 0) {
    return (
      <Box>
        <Text color={Colors.muted}>No file changes captured yet.</Text>
      </Box>
    );
  }

  // ── Detail mode ──────────────────────────────────────────────────
  if (filePath) {
    const target = diffs.find((d) => d.path === filePath);
    if (!target) {
      return (
        <Box>
          <Text color={Colors.error}>
            {Icons.cross} No diff captured for {displayPath(filePath, installDir)}
          </Text>
        </Box>
      );
    }
    const patchLines = stripPatchHeader(target.patch);
    const slice = patchLines.slice(scrollOffset, scrollOffset + maxLines);
    return (
      <Box flexDirection="column">
        <Box>
          <Text color={OP_COLORS[target.operation]} bold>
            {OP_LABELS[target.operation]}
          </Text>
          <Text> </Text>
          <Text color={Colors.body} bold>
            {displayPath(target.path, installDir)}
          </Text>
          <Text color={Colors.subtle}> {Icons.dot} </Text>
          <Text color={Colors.muted}>
            {formatChangeCounts(target.additions, target.deletions)}
          </Text>
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {slice.length === 0 ? (
            <Text color={Colors.muted}>(empty patch)</Text>
          ) : (
            slice.map((raw, i) => {
              const { color, line } = classifyPatchLine(raw);
              return (
                <Text key={`${scrollOffset}-${i}`} color={color}>
                  {line || ' '}
                </Text>
              );
            })
          )}
        </Box>
        {patchLines.length > scrollOffset + maxLines && (
          <Box marginTop={1}>
            <Text color={Colors.muted}>
              {patchLines.length - scrollOffset - maxLines} more line
              {patchLines.length - scrollOffset - maxLines === 1 ? '' : 's'}{' '}
              {Icons.dot} press j/k or arrow keys to scroll
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  // ── Summary mode ─────────────────────────────────────────────────
  const totalAdd = diffs.reduce((sum, d) => sum + d.additions, 0);
  const totalDel = diffs.reduce((sum, d) => sum + d.deletions, 0);
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={Colors.heading} bold>
          What changed
        </Text>
        <Text color={Colors.subtle}> {Icons.dot} </Text>
        <Text color={Colors.muted}>
          {diffs.length} file{diffs.length === 1 ? '' : 's'}
        </Text>
        <Text color={Colors.subtle}> {Icons.dot} </Text>
        <Text color={Colors.success}>+{totalAdd}</Text>
        <Text color={Colors.muted}> / </Text>
        <Text color={Colors.error}>-{totalDel}</Text>
      </Box>
      {diffs.map((d) => (
        <Box key={d.path}>
          <Text> </Text>
          <Text color={OP_COLORS[d.operation]} bold>
            {OP_LABELS[d.operation]}
          </Text>
          <Text> </Text>
          <Text color={Colors.body} wrap="truncate-end">
            {displayPath(d.path, installDir)}
          </Text>
          <Text color={Colors.subtle}> {Icons.dot} </Text>
          <Text color={Colors.success}>+{d.additions}</Text>
          <Text color={Colors.muted}>/</Text>
          <Text color={Colors.error}>-{d.deletions}</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color={Colors.muted}>
          Use <Text color={Colors.accent}>/diff &lt;path&gt;</Text> to view a
          file diff.
        </Text>
      </Box>
    </Box>
  );
};
