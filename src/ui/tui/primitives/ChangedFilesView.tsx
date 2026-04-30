/**
 * ChangedFilesView — Read-only "press D to see diffs" review pane shown
 * on the success outro.
 *
 * Two states:
 *   - list view    — file names with create/modify badges; arrow keys
 *                    move the cursor, Enter opens the diff for the
 *                    selected file
 *   - detail view  — `git diff --no-color HEAD -- <path>` output for one
 *                    file, scrollable line-by-line
 *
 * Esc navigates up: detail → list, list → close (handled by parent).
 *
 * Diffs are produced with `child_process.execFileSync` (NO shell) and
 * truncated at 10k chars to keep the render cheap on huge files. When
 * git is unavailable or the file isn't tracked, we surface a friendly
 * "(no git diff available — file may be new)" placeholder so the user
 * still sees the file existed without a confusing crash.
 *
 * Goal: users gain trust that the wizard did what it claimed without
 * leaving the terminal. Keep it simple — no syntax highlighting, no
 * cross-commit diffs, no editing. Strictly a review surface.
 */

import { Box, Text } from 'ink';
import { useMemo, useState } from 'react';
import { execFileSync } from 'node:child_process';
import { Colors, Icons } from '../styles.js';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';
import { analytics } from '../../../utils/analytics.js';

/** Hard cap on diff bytes shown inline. Anything larger is truncated. */
export const MAX_DIFF_CHARS = 10_000;

/** Rows consumed by chrome (header + footer + spacing). */
const CHROME_ROWS = 8;

export interface ChangedFile {
  path: string;
  /** 'create' for newly written files, 'modify' for edits in place. */
  kind: 'create' | 'modify';
}

interface ChangedFilesViewProps {
  files: ChangedFile[];
  /** Working directory for `git diff` invocations. */
  cwd: string;
  /** Called when the user dismisses the view from the list pane. */
  onClose: () => void;
}

/**
 * Build a sorted, de-duplicated `ChangedFile[]` from the registry's raw
 * `files.written` / `files.modified` arrays. `written` wins on conflict
 * so a path that appears in both lists is shown as a 'create'.
 *
 * Pure for unit testing.
 */
export function buildChangedFileList(
  written: readonly string[],
  modified: readonly string[],
): ChangedFile[] {
  const writtenSet = new Set(written);
  const out: ChangedFile[] = [];
  for (const path of written) out.push({ path, kind: 'create' });
  for (const path of modified) {
    if (!writtenSet.has(path)) out.push({ path, kind: 'modify' });
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/**
 * Run `git diff --no-color HEAD -- <path>` synchronously and return the
 * output (or a placeholder string when git fails). Truncates to
 * `MAX_DIFF_CHARS` and appends a footer when truncation happens.
 *
 * Exported for test injection — the component calls this lazily on demand.
 */
export function readGitDiff(cwd: string, path: string): string {
  try {
    const raw = execFileSync('git', ['diff', '--no-color', 'HEAD', '--', path], {
      cwd,
      encoding: 'utf-8',
      // Cap stdout so a runaway diff can't OOM the wizard. Anything
      // beyond the cap is dropped by Node and we surface our own
      // truncation footer below.
      maxBuffer: MAX_DIFF_CHARS * 2,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (!raw || raw.trim().length === 0) {
      return '(no git diff available — file may be new)';
    }
    if (raw.length > MAX_DIFF_CHARS) {
      return (
        raw.slice(0, MAX_DIFF_CHARS) +
        '\n\n(diff truncated, see file directly)'
      );
    }
    return raw;
  } catch {
    return '(no git diff available — file may be new)';
  }
}

export const ChangedFilesView = ({
  files,
  cwd,
  onClose,
}: ChangedFilesViewProps) => {
  const [, rows] = useStdoutDimensions();
  const visibleLines = Math.max(5, rows - CHROME_ROWS);

  const [cursor, setCursor] = useState(0);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [diffOffset, setDiffOffset] = useState(0);

  const open = openIndex !== null ? files[openIndex] : null;

  // Compute the diff lazily once per opened file. Memoizing on path keeps
  // arrow-key navigation in the diff pane O(1) — we don't want to fork
  // git on every keypress.
  const diffLines = useMemo(() => {
    if (!open) return [] as string[];
    return readGitDiff(cwd, open.path).split('\n');
  }, [open, cwd]);

  const maxOffset = Math.max(0, diffLines.length - visibleLines);

  useScreenInput((input, key) => {
    // Detail view ─────────────────────────────────────────────────────
    if (open) {
      if (key.escape) {
        setOpenIndex(null);
        setDiffOffset(0);
        return;
      }
      if (key.upArrow || input === 'k') {
        setDiffOffset((o) => Math.max(0, o - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setDiffOffset((o) => Math.min(maxOffset, o + 1));
        return;
      }
      if (key.pageUp) {
        setDiffOffset((o) => Math.max(0, o - visibleLines));
        return;
      }
      if (key.pageDown) {
        setDiffOffset((o) => Math.min(maxOffset, o + visibleLines));
        return;
      }
      return;
    }

    // List view ───────────────────────────────────────────────────────
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow || input === 'k') {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow || input === 'j') {
      setCursor((c) => Math.min(files.length - 1, c + 1));
      return;
    }
    if (key.return || input === 'd' || input === 'D') {
      if (files.length === 0) return;
      const idx = Math.max(0, Math.min(files.length - 1, cursor));
      analytics.wizardCapture('view changes file selected', {
        'file kind': files[idx].kind,
        'file index': idx,
        'file count': files.length,
      });
      setOpenIndex(idx);
      setDiffOffset(0);
    }
  });

  // ── Empty state ─────────────────────────────────────────────────────
  if (files.length === 0) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color={Colors.accent}>
            Files changed
          </Text>
          <Text color={Colors.muted}> (Esc to go back)</Text>
        </Box>
        <Text color={Colors.muted}>
          No file changes were tracked for this run.
        </Text>
      </Box>
    );
  }

  // ── Detail view ─────────────────────────────────────────────────────
  if (open) {
    const visible = diffLines.slice(diffOffset, diffOffset + visibleLines);
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Box marginBottom={1} flexDirection="column">
          <Text bold color={Colors.accent}>
            {Icons.diamond} {open.path}
          </Text>
          <Text color={Colors.muted}>
            Esc to go back · ↑↓/jk to scroll · PgUp/PgDn to page
          </Text>
        </Box>
        <Box flexDirection="column" height={visibleLines}>
          {visible.map((line, i) => (
            <Text key={diffOffset + i} color={diffLineColor(line)} wrap="truncate">
              {line || ' '}
            </Text>
          ))}
        </Box>
        {diffLines.length > visibleLines && (
          <Text color={Colors.muted}>
            {Icons.dot} {diffOffset + visible.length}/{diffLines.length} lines
          </Text>
        )}
      </Box>
    );
  }

  // ── List view ───────────────────────────────────────────────────────
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box marginBottom={1} flexDirection="column">
        <Text bold color={Colors.accent}>
          Files changed
        </Text>
        <Text color={Colors.muted}>
          {files.length} file{files.length === 1 ? '' : 's'} · ↑↓ to move ·
          Enter to view diff · Esc to go back
        </Text>
      </Box>
      <Box flexDirection="column">
        {files.map((file, i) => {
          const isSelected = i === cursor;
          return (
            <Text
              key={file.path}
              color={isSelected ? Colors.heading : Colors.body}
              wrap="truncate"
            >
              <Text color={isSelected ? Colors.accent : Colors.subtle}>
                {isSelected ? Icons.chevronRight : ' '}{' '}
              </Text>
              <Text
                color={
                  file.kind === 'create' ? Colors.success : Colors.accentSecondary
                }
                bold
              >
                {file.kind === 'create' ? '＋ new   ' : '~ modify '}
              </Text>
              {file.path}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
};

/**
 * Map a unified-diff line prefix to a semantic color. Pure helper so
 * the component body stays focused on layout. Exposed as a non-default
 * export only via the component module.
 */
function diffLineColor(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return Colors.muted;
  if (line.startsWith('@@')) return Colors.accentSecondary;
  if (line.startsWith('+')) return Colors.success;
  if (line.startsWith('-')) return Colors.error;
  if (line.startsWith('diff ') || line.startsWith('index ')) return Colors.muted;
  return Colors.body;
}
