/**
 * DiffViewer — snapshot + behaviour coverage for the per-file and tree
 * diff renderings sourced from the FileChangeLedger.
 *
 * Locks down:
 *   - Empty-state copy when no diffs are captured.
 *   - Summary mode lists every diff with +N/-M counts.
 *   - Detail mode renders the unified-patch body and skips the metadata
 *     headers added by `createPatch`.
 *   - `classifyPatchLine` colours additions/deletions/hunk-headers
 *     correctly so screen-reader output stays readable.
 *   - "More lines" footer appears when the patch overflows `maxLines`.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import {
  DiffViewer,
  classifyPatchLine,
  formatChangeCounts,
} from '../DiffViewer.js';
import type { FileDiffSummary } from '../../../../lib/file-change-diff.js';
import { Colors } from '../../styles.js';

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const stripAnsi = (s: string): string => s.replace(ANSI, '');

const samplePatch = `Index: a.txt
===================================================================
--- a.txt\t
+++ a.txt\t
@@ -1,3 +1,3 @@
 hello
-old line
+new line
 trailing
`;

const buildDiff = (
  overrides: Partial<FileDiffSummary> = {},
): FileDiffSummary => ({
  path: '/proj/src/a.txt',
  operation: 'modify',
  additions: 1,
  deletions: 1,
  patch: samplePatch,
  hunks: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3 }],
  ...overrides,
});

describe('formatChangeCounts', () => {
  it('returns "no textual change" when both counts are zero', () => {
    expect(formatChangeCounts(0, 0)).toBe('no textual change');
  });

  it('formats non-zero counts as +N / -M', () => {
    expect(formatChangeCounts(3, 2)).toBe('+3 / -2');
  });
});

describe('classifyPatchLine', () => {
  it('marks hunk headers with the accent colour', () => {
    expect(classifyPatchLine('@@ -1,3 +1,3 @@').color).toBe(Colors.accent);
  });

  it('marks added lines (single +) with success colour', () => {
    expect(classifyPatchLine('+new line').color).toBe(Colors.success);
  });

  it('marks deleted lines (single -) with error colour', () => {
    expect(classifyPatchLine('-old line').color).toBe(Colors.error);
  });

  it('correctly classifies content lines whose body starts with ++ / --', () => {
    // C++ `++i;` at column 0 → hunk line `+++i;`. SQL `-- comment`
    // at column 0 → hunk line `--- comment`. Both are real
    // additions/deletions inside hunks, NOT file headers (which
    // `stripPatchHeader` already removed). Pre-fix, the
    // `!startsWith('+++') / !startsWith('---')` guards mis-classified
    // these as muted context.
    expect(classifyPatchLine('+++i;').color).toBe(Colors.success);
    expect(classifyPatchLine('--- select * from t').color).toBe(Colors.error);
  });

  it('marks "no newline at end" trailers with the subtle colour', () => {
    expect(classifyPatchLine('\\ No newline at end of file').color).toBe(
      Colors.subtle,
    );
  });

  it('marks plain context lines as muted', () => {
    expect(classifyPatchLine(' context').color).toBe(Colors.muted);
  });
});

describe('DiffViewer — empty state', () => {
  it('renders an empty-state line when diffs is empty', () => {
    const { lastFrame } = render(<DiffViewer diffs={[]} />);
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('No file changes captured yet');
  });
});

describe('DiffViewer — summary mode', () => {
  it('renders one row per diff with a relativized path', () => {
    const { lastFrame } = render(
      <DiffViewer
        diffs={[
          buildDiff({ path: '/proj/src/a.ts', additions: 5, deletions: 0 }),
          buildDiff({
            path: '/proj/src/b.ts',
            operation: 'create',
            additions: 12,
            deletions: 0,
          }),
        ]}
        installDir="/proj"
      />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('What changed');
    expect(out).toContain('src/a.ts');
    expect(out).toContain('src/b.ts');
    expect(out).toContain('+5');
    expect(out).toContain('+12');
    // Absolute prefix relativized away.
    expect(out).not.toContain('/proj/src/a.ts');
  });

  it('shows the total +N/-M roll-up in the header', () => {
    const { lastFrame } = render(
      <DiffViewer
        diffs={[
          buildDiff({ additions: 4, deletions: 2 }),
          buildDiff({ path: '/p/b', additions: 3, deletions: 5 }),
        ]}
      />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('+7'); // 4 + 3
    expect(out).toContain('-7'); // 2 + 5
  });

  it('hints the user about the Diff tab in summary mode', () => {
    const { lastFrame } = render(
      <DiffViewer diffs={[buildDiff()]} installDir="/proj" />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Diff');
    // The deprecated /diff slash command must not be re-introduced here.
    expect(out).not.toContain('/diff');
  });
});

describe('DiffViewer — detail mode', () => {
  it('renders the patch body for the matching path and strips meta headers', () => {
    const { lastFrame } = render(
      <DiffViewer
        diffs={[buildDiff()]}
        filePath="/proj/src/a.txt"
        installDir="/proj"
      />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('@@ -1,3 +1,3 @@');
    expect(out).toContain('+new line');
    expect(out).toContain('-old line');
    // Metadata header rows from createPatch must be stripped.
    expect(out).not.toContain('Index: a.txt');
    expect(out).not.toContain('===================================================================');
  });

  it('shows an error when the requested path has no captured diff', () => {
    const { lastFrame } = render(
      <DiffViewer
        diffs={[buildDiff()]}
        filePath="/proj/nope.txt"
        installDir="/proj"
      />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('No diff captured');
  });

  it('renders the "more lines" footer when the patch exceeds maxLines', () => {
    // Synthesize a long patch so we can validate the truncation footer.
    const longBody = ['@@ -1,5 +1,5 @@'];
    for (let i = 0; i < 50; i++) longBody.push(`+added ${i}`);
    const longPatch = `Index: foo\n===\n--- foo\n+++ foo\n${longBody.join('\n')}\n`;
    const { lastFrame } = render(
      <DiffViewer
        diffs={[
          buildDiff({ patch: longPatch, additions: 50, deletions: 0 }),
        ]}
        filePath="/proj/src/a.txt"
        installDir="/proj"
        maxLines={10}
      />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toMatch(/more line/);
    expect(out).toMatch(/scroll/);
  });
});
