/**
 * Regression test for Bugbot #6 on PR #599 — DiffViewer, FileWritesPanel,
 * and ConsoleView all funnel through the shared `displayPath` helper so the
 * out-of-project fallback is consistent (basename, not raw path).
 */
import path from 'path';
import { describe, expect, test } from 'vitest';

import { displayPath } from '../display-path.js';

describe('displayPath', () => {
  const installDir = path.resolve('/Users/dev/project');

  test('relativizes paths inside installDir', () => {
    const raw = path.join(installDir, 'src', 'app.ts');
    expect(displayPath(raw, installDir)).toBe(path.join('src', 'app.ts'));
  });

  test('returns basename when installDir matches exactly', () => {
    expect(displayPath(installDir, installDir)).toBe(path.basename(installDir));
  });

  test('falls back to basename for absolute out-of-project paths', () => {
    const outside = path.resolve('/tmp/some-skill/install.sh');
    // Regression: the old DiffViewer copy returned `raw` here while
    // FileWritesPanel returned `basename`. Unified fallback is basename.
    expect(displayPath(outside, installDir)).toBe('install.sh');
  });

  test('respects path-segment boundary (no prefix-string match)', () => {
    // `installDir` is `/Users/dev/project`. A sibling like
    // `/Users/dev/project-other/x.ts` must NOT be relativized — it shares
    // the textual prefix but lives in a different directory.
    const sibling = path.resolve('/Users/dev/project-other/x.ts');
    expect(displayPath(sibling, installDir)).toBe('x.ts');
  });

  test('returns raw for relative paths when no installDir is given', () => {
    expect(displayPath('src/app.ts')).toBe('src/app.ts');
  });

  test('returns raw for relative paths even when installDir is set', () => {
    expect(displayPath('src/app.ts', installDir)).toBe('src/app.ts');
  });
});
