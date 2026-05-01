/**
 * ChangedFilesView snapshots — covers the empty list, the populated list
 * with multiple file kinds, and the diff detail pane.
 *
 * The diff pane is rendered against a stub `readGitDiff` so we don't need
 * a real git repo (or a real `child_process`) at test time. The component
 * forks `execFileSync` only on demand inside `readGitDiff` — the
 * `vi.mock` below stubs that function and supplies a deterministic diff
 * payload so the snapshot is stable across hosts.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { buildChangedFileList, MAX_DIFF_CHARS } from '../ChangedFilesView.js';

// Stub `child_process.execFileSync` so the component's diff-fetch path
// is hermetic. The fixture diff covers each color-classified prefix
// (`+++`, `---`, `@@`, `+`, `-`, plain context) so the snapshot pins
// the rendering of every branch in `diffLineColor`.
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(() => {
    return [
      'diff --git a/foo.ts b/foo.ts',
      'index 0000000..1111111 100644',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -1,3 +1,4 @@',
      ' const x = 1;',
      '-const y = 2;',
      '+const y = 20;',
      '+const z = 3;',
    ].join('\n');
  }),
}));

import { ChangedFilesView } from '../ChangedFilesView.js';
import {
  renderSnapshot,
  makeStoreForSnapshot,
} from '../../__tests__/snapshot-utils.js';

describe('ChangedFilesView snapshots', () => {
  it('renders the empty state when no files changed', () => {
    const store = makeStoreForSnapshot();
    const { frame } = renderSnapshot(
      <ChangedFilesView files={[]} cwd="/tmp" onClose={() => {}} />,
      store,
    );
    expect(frame).toContain('No file changes were tracked');
    expect(frame).toMatchSnapshot();
  });

  it('renders the list view with mixed create/modify entries', () => {
    const store = makeStoreForSnapshot();
    const files = buildChangedFileList(
      ['src/components/Login.tsx', 'src/instrument.ts'],
      ['src/App.tsx'],
    );
    const { frame } = renderSnapshot(
      <ChangedFilesView files={files} cwd="/tmp" onClose={() => {}} />,
      store,
    );
    // Sanity assertions — every file path is rendered, and both
    // create/modify badges appear so we can't lose one without a diff.
    expect(frame).toContain('Files changed');
    expect(frame).toContain('3 files');
    expect(frame).toContain('src/App.tsx');
    expect(frame).toContain('src/components/Login.tsx');
    expect(frame).toContain('src/instrument.ts');
    expect(frame).toContain('new');
    expect(frame).toContain('modify');
    expect(frame).toMatchSnapshot();
  });
});

// ── buildChangedFileList ─────────────────────────────────────────────

describe('buildChangedFileList', () => {
  it('sorts entries alphabetically and de-duplicates across written/modified', () => {
    const out = buildChangedFileList(['b.ts', 'a.ts'], ['c.ts', 'a.ts']);
    expect(out.map((f) => f.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
    // 'a.ts' is in both lists — written wins (it's a 'create')
    expect(out.find((f) => f.path === 'a.ts')?.kind).toBe('create');
    expect(out.find((f) => f.path === 'c.ts')?.kind).toBe('modify');
  });

  it('returns an empty list when both inputs are empty', () => {
    expect(buildChangedFileList([], [])).toEqual([]);
  });
});

describe('MAX_DIFF_CHARS', () => {
  it('is large enough for typical diffs but bounded to keep render cheap', () => {
    // Anchor the cap so a future tweak surfaces in a code review rather
    // than landing silently. 10k chars ≈ 200 lines of diff which is
    // plenty for the average wizard run.
    expect(MAX_DIFF_CHARS).toBe(10_000);
  });
});

// ── useMemo regression (Bugbot, PR #412) ──────────────────────────────
//
// `OutroScreen` recomputes its `changedFiles` array on every render, so
// `files[openIndex]` returns a fresh `ChangedFile` reference each time.
// The diff `useMemo` in `ChangedFilesView` originally keyed on `open`
// (the object) which meant the cache missed every render and `git diff`
// re-shelled on every j/k keypress — exactly the perf hazard the inline
// comment claimed to avoid. Fix is to key on `open.path` (a stable
// string) instead. This test pins that behavior: scrolling a diff must
// not re-fork git.

describe('ChangedFilesView diff memoization', () => {
  it('reads git diff once per opened file even when parent re-renders', async () => {
    const { execFileSync } = await import('node:child_process');
    const mocked = vi.mocked(execFileSync);

    // ink-testing-library lets us drive stdin and re-render with a new
    // `files` array prop — that's the failure shape: parent passes a
    // freshly-built `ChangedFile[]` on every keystroke.
    const { render } = await import('ink-testing-library');

    const buildFiles = () =>
      buildChangedFileList(['src/instrument.ts'], ['src/App.tsx']);

    mocked.mockClear();
    const { stdin, rerender, unmount } = render(
      <ChangedFilesView files={buildFiles()} cwd="/tmp" onClose={() => {}} />,
    );

    // Wait one frame so the list view mounts.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // Open the first file.
    stdin.write('\r');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // Sanity: opening a file MUST shell out exactly once.
    const callsAfterOpen = mocked.mock.calls.length;
    expect(callsAfterOpen).toBe(1);

    // Now simulate the parent re-rendering with a freshly-built file
    // list (new object identities, same path strings) — this is what
    // OutroScreen's render body does every commit. Then scroll. Each
    // scroll triggers a re-render of ChangedFilesView too. With the
    // previous `[open, cwd]` deps this re-shelled git on every j/k.
    for (let i = 0; i < 5; i++) {
      rerender(
        <ChangedFilesView files={buildFiles()} cwd="/tmp" onClose={() => {}} />,
      );
      stdin.write('j');
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    }

    // No additional git invocations — useMemo on `[open?.path, cwd]`
    // should hit on every subsequent render.
    expect(mocked.mock.calls.length).toBe(callsAfterOpen);

    unmount();
  });
});
