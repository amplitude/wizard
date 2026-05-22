/**
 * DiffTab — persistent Diff tab in the RunScreen.
 *
 * Replaces the old `/diff <path>` slash command. Shows a vertical list
 * of every file the inner agent has touched during this run, with a
 * colored unified diff for the currently-focused file rendered below
 * it. The user navigates between files with ↑↓ (or j/k), and scrolls
 * within a single diff with PageUp / PageDown.
 *
 * Data sources
 * ────────────
 *   - The file LIST comes from the live `$fileWrites` atom on the
 *     store (subscribed via `useWizardStore`). That atom is bounded to
 *     MAX_FILE_WRITES entries (FIFO), so for runs that touch hundreds
 *     of files the tab shows the most recent N — which matches the
 *     live FileWritesPanel on the Progress tab. The list is deduped
 *     by path (the agent often re-edits the same file) and ordered
 *     newest-first so the user lands on the file the agent just
 *     finished writing.
 *   - The colored DIFF for the selected file comes from the canonical
 *     `FileChangeLedger`. We subscribe to `fileWritesTotal` so the
 *     ledger walk re-runs every time a new write lands — not on every
 *     spinner tick.
 *
 * Performance
 * ───────────
 *   `DiffViewer` already windows the patch body to `maxLines` (default
 *   30) around `scrollOffset`. For large diffs (>1000 lines) we keep
 *   that contract — rendering ~30 lines at a time keeps the Ink frame
 *   small regardless of total patch size.
 *
 * Color tokens / glyphs
 * ─────────────────────
 *   Reuses DiffViewer's classify-and-color helper for the patch body
 *   (additions → success, deletions → error, hunks → accent). The
 *   file-list rows use the design-kit glyphs:
 *     - `✎`  edit indicator (per-file row prefix)
 *     - `❯`  selection caret (replaces the edit glyph on the active row)
 *     - `+N` / `−M` change counts (success / error)
 *
 * Keyboard
 * ────────
 *   ↑ / k       move selection up
 *   ↓ / j       move selection down
 *   PageUp      scroll the diff body up
 *   PageDown    scroll the diff body down
 *
 *   ← / → are owned by TabContainer (switch tabs) and must continue
 *   to work — useScreenInput here only consumes the keys we care
 *   about. Anything else falls through.
 */

import { Box, Text } from 'ink';
import { useEffect, useMemo, useState } from 'react';

import { getFileChangeLedger } from '../../../lib/file-change-ledger.js';
import {
  summarizeLedgerDiffs,
  type FileDiffSummary,
} from '../../../lib/file-change-diff.js';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { useWizardStore } from '../hooks/useWizardStore.js';
import { Colors, Icons } from '../styles.js';
import type { WizardStore } from '../store.js';
import { displayPath } from '../utils/display-path.js';
import { DiffViewer } from './DiffViewer.js';

interface DiffTabProps {
  store: WizardStore;
  /**
   * Max patch lines rendered in a single frame. Exposed for tests so
   * scroll behavior can be exercised without synthesising a 60+ line
   * patch.
   */
  maxLines?: number;
}

const DEFAULT_MAX_LINES = 30;

/**
 * Build the file list rendered in the top pane.
 *
 * Source of truth is the canonical `FileChangeLedger`. We pass the
 * monotonic `fileWritesTotal` counter through `refreshKey` (via the
 * `useMemo` dep) so the walk re-runs once per new write — not on every
 * spinner tick.
 *
 * Order: newest-first. Reasoning: when the user opens the Diff tab
 * mid-run, the file they care about is almost always the one the agent
 * JUST wrote. The chronological-oldest-first ordering of the ledger
 * itself is preserved on the underlying summary list — we reverse here
 * at the render layer so a future caller (e.g. an end-of-run summary)
 * that wants chronological order can keep the existing helper.
 */
function useDiffSummaries(refreshKey: number): FileDiffSummary[] {
  return useMemo(() => {
    const ledger = getFileChangeLedger();
    if (!ledger) return [];
    // Need the patch bodies for the bottom pane — `includePatch: true`
    // is the default. The cost is one `createPatch` per ledger entry,
    // which only runs when `refreshKey` advances.
    const all = summarizeLedgerDiffs(ledger);
    // Dedupe by path (the ledger keeps a row per Pre/PostToolUse pair,
    // and a re-edit of the same file shows up twice). The latest entry
    // for a given path wins.
    const byPath = new Map<string, FileDiffSummary>();
    for (const d of all) byPath.set(d.path, d);
    // Newest-first: reverse the insertion order so the most recently
    // touched file lands at the top of the list.
    return Array.from(byPath.values()).reverse();
    // `refreshKey` is the monotonic counter we explicitly want to
    // re-walk against — the ledger itself is a module-level singleton,
    // so listing it as a dep would mislead future readers.
  }, [refreshKey]);
}

/** Empty-state copy when no file changes have landed yet. */
const EmptyState = () => (
  <Box flexDirection="column" paddingX={1}>
    <Text color={Colors.muted}>
      no file changes yet — the agent hasn&apos;t edited anything
    </Text>
  </Box>
);

interface FileListProps {
  files: FileDiffSummary[];
  selectedIndex: number;
  installDir?: string;
}

/** Vertical list of touched files. Renders one line per file. */
const FileList = ({ files, selectedIndex, installDir }: FileListProps) => {
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box paddingX={1}>
        <Text color={Colors.heading} bold>
          Changed files
        </Text>
        <Text color={Colors.subtle}> {Icons.dot} </Text>
        <Text color={Colors.muted}>
          {files.length} file{files.length === 1 ? '' : 's'}
        </Text>
      </Box>
      {files.map((f, i) => {
        const isSelected = i === selectedIndex;
        const prefix = isSelected ? Icons.prompt : Icons.bar;
        const prefixColor = isSelected ? Colors.accent : Colors.subtle;
        const pathColor = isSelected ? Colors.accent : Colors.body;
        // Single <Text> row with `wrap="truncate-end"` so narrow
        // terminals collapse the whole row uniformly — same approach
        // DiffViewer's summary mode uses (one terminal row per file
        // regardless of viewport width). Each inline <Text> child
        // keeps its own color.
        return (
          <Text key={f.path} wrap="truncate-end">
            <Text color={prefixColor} bold={isSelected}>
              {' '}
              {prefix}{' '}
            </Text>
            <Text color={Colors.muted}>{isSelected ? ' ' : Icons.checkmark}</Text>
            <Text color={pathColor} bold={isSelected}>
              {' '}
              {displayPath(f.path, installDir)}
            </Text>
            <Text color={Colors.subtle}> {Icons.dot} </Text>
            <Text color={Colors.success}>+{f.additions}</Text>
            <Text color={Colors.muted}>/</Text>
            <Text color={Colors.error}>-{f.deletions}</Text>
          </Text>
        );
      })}
    </Box>
  );
};

/**
 * DiffTab — the exported tab body. Owns selection state and key input;
 * delegates rendering to the FileList + DiffViewer leaves.
 */
export const DiffTab = ({ store, maxLines = DEFAULT_MAX_LINES }: DiffTabProps) => {
  // Subscribe to the store so file-list refreshes track new writes. The
  // hook re-renders this component whenever any atom on the store changes;
  // the underlying summary memo is keyed on `fileWritesTotal`, so an
  // unrelated re-render (e.g. spinner tick) doesn't re-walk the ledger.
  useWizardStore(store);

  const files = useDiffSummaries(store.fileWritesTotal);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Clamp the selected index whenever the file list shrinks (the FIFO
  // bounded list can evict entries). Reset scroll when the selection
  // changes so the new diff renders from the top.
  useEffect(() => {
    if (files.length === 0) {
      if (selectedIndex !== 0) setSelectedIndex(0);
      return;
    }
    if (selectedIndex >= files.length) {
      setSelectedIndex(files.length - 1);
    }
  }, [files.length, selectedIndex]);

  // When the selected file changes, reset the scroll offset for the
  // diff body. Without this, switching from a long diff (scrollOffset
  // = 40) to a short one would render blank — DiffViewer's slice would
  // start past the end of the patch.
  useEffect(() => {
    setScrollOffset(0);
  }, [selectedIndex]);

  useScreenInput((input, key) => {
    // Up / down: move selection. j / k mirror vim-style nav for users
    // who reach there reflexively. ← / → fall through to TabContainer.
    if (key.upArrow || input === 'k') {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow || input === 'j') {
      setSelectedIndex((i) => Math.min(Math.max(0, files.length - 1), i + 1));
      return;
    }
    // PageUp / PageDown: scroll within the current diff body. The
    // `maxLines` default of 30 means a full page is exactly the window
    // size, so PgDn advances by one screenful.
    if (key.pageUp) {
      setScrollOffset((o) => Math.max(0, o - maxLines));
      return;
    }
    if (key.pageDown) {
      setScrollOffset((o) => o + maxLines);
      return;
    }
  });

  if (files.length === 0) {
    return <EmptyState />;
  }

  const selected = files[selectedIndex];

  return (
    // Outer Box uses `overflow="hidden"` — same defense the rest of the
    // TUI uses against PR #779's Yoga overdraw bug, where a tall diff
    // could push the tab bar / chrome off-screen.
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <FileList
        files={files}
        selectedIndex={selectedIndex}
        installDir={store.session.installDir}
      />
      <Box marginTop={1} paddingX={1} flexDirection="column">
        <DiffViewer
          diffs={files}
          filePath={selected.path}
          installDir={store.session.installDir}
          scrollOffset={scrollOffset}
          maxLines={maxLines}
        />
      </Box>
    </Box>
  );
};
