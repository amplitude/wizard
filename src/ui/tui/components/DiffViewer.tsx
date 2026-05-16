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
 *     +N/-M counts. Used by the outro's "what changed" section.
 *   - **detail** (`path` prop set): unified diff for that one file with
 *     scrollable hunks. Used by the RunScreen Diff tab.
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
import { Colors, Icons } from '../styles.js';
import type { FileDiffSummary } from '../../../lib/file-change-diff.js';
import { displayPath } from '../utils/display-path.js';

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
  // `stripPatchHeader` removes everything before the first `@@`, so the
  // `+++`/`---` file-header lines never reach this point. Inside hunks,
  // every '+' / '-' prefix is a real addition or deletion — including
  // lines whose CONTENT begins with `++` or `--` (e.g. C++ `++i;` →
  // `+++i;` or SQL/Lua `-- comment` → `--- comment`). The previous
  // `!startsWith('+++') / !startsWith('---')` guards mis-classified
  // those as context.
  if (line.startsWith('@@')) return { color: Colors.accent, line };
  if (line.startsWith('\\ No newline')) {
    // jsdiff emits this trailer when a file lacks a final newline. It's
    // metadata, not content — render dimmed and small.
    return { color: Colors.subtle, line };
  }
  if (line.startsWith('+')) return { color: Colors.success, line };
  if (line.startsWith('-')) return { color: Colors.error, line };
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
      {/* Render each file row as a SINGLE <Text> with `wrap="truncate-end"`
          so the whole row collapses uniformly when narrower than the
          combined natural width. The previous version composed a row out
          of seven separate <Text> siblings inside a default-row <Box>; on
          narrow terminals Yoga had no width budget to share among them
          and the result was rows mashed together with missing prefixes
          and stray fragments of neighbouring rows ("NEW report.md ·
          +78/-0AddToLibrary.tsx · +2/-0"). One <Text> per row guarantees
          one terminal line per row no matter the width. We render with
          inline child <Text>s so each segment keeps its color. */}
      {diffs.map((d) => (
        <Text key={d.path} wrap="truncate-end">
          {' '}
          <Text color={OP_COLORS[d.operation]} bold>
            {OP_LABELS[d.operation]}
          </Text>{' '}
          <Text color={Colors.body}>{displayPath(d.path, installDir)}</Text>
          <Text color={Colors.subtle}> {Icons.dot} </Text>
          <Text color={Colors.success}>+{d.additions}</Text>
          <Text color={Colors.muted}>/</Text>
          <Text color={Colors.error}>-{d.deletions}</Text>
        </Text>
      ))}
      <Box marginTop={1}>
        <Text color={Colors.muted}>
          Open the <Text color={Colors.accent}>Diff</Text> tab to inspect any
          file.
        </Text>
      </Box>
    </Box>
  );
};
