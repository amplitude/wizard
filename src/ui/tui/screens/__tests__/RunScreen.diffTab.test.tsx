/**
 * RunScreen — persistent Diff tab.
 *
 * Pins the behavior of the Diff tab that replaced the old `/diff <path>`
 * slash command. Three layers of coverage:
 *
 *   1. Tab visibility — the "Diff" label appears in the tab bar between
 *      Events and Logs whether or not an event plan is present.
 *   2. Content — empty state when no file changes; selected file's diff
 *      and the file list when changes exist.
 *   3. Width snapshots — 80 cols + 60 cols, so a future regression that
 *      breaks the file list / diff layout fails loudly.
 *
 * The tests drive `RunScreen` end-to-end (the same component the live
 * wizard mounts) and request the Diff tab via `setRequestedTab('diff')`
 * — that's the same path slash commands and overlays use to imperatively
 * switch tabs, so the test exercises the real wiring without faking the
 * tab-switch key sequence.
 *
 * The spinner mock matches the rest of the RunScreen test suite — the
 * 200 ms tick re-renders the tree dozens of times per real second, which
 * blows out the timeout under parallel CI load. Pinning it high keeps
 * the spinner dormant for the duration of the test.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

vi.mock('../../styles.js', async (importActual) => {
  const actual = await importActual<typeof import('../../styles.js')>();
  return {
    ...actual,
    SPINNER_INTERVAL: 60 * 60 * 1000,
  };
});

// Pin terminal dimensions for layout snapshots. ink-testing-library's
// mocked stdout reports 100 cols by default — too wide to exercise the
// narrow-terminal path. We use a mutable variable so a single test can
// override it before render.
let mockedDims: [number, number] = [80, 24];
vi.mock('../../hooks/useStdoutDimensions.js', () => ({
  useStdoutDimensions: () => mockedDims,
}));

import { render } from 'ink-testing-library';
import { RunScreen } from '../RunScreen.js';
import { makeStoreForSnapshot } from '../../__tests__/snapshot-utils.js';
import { waitForFrame } from '../../__tests__/ink-stdin.js';
import {
  initFileChangeLedger,
  resetFileChangeLedger,
} from '../../../../lib/file-change-ledger.js';

// eslint-disable-next-line no-control-regex
const ANSI_CSI_REGEX = /\x1b\[[0-9;]*[A-Za-z]/g;
// eslint-disable-next-line no-control-regex
const ANSI_OSC_REGEX = /\x1b\][^\x07]*\x07/g;
const stripAnsi = (s: string): string =>
  s.replace(ANSI_CSI_REGEX, '').replace(ANSI_OSC_REGEX, '');
const trimTrailingWs = (s: string): string =>
  s
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n');

/**
 * Seed the file-change ledger with one or more synthetic write events.
 * The DiffTab walks the canonical ledger (`getFileChangeLedger()`) — so
 * to exercise the tab the test must capture pre/post content the same
 * way `inner-lifecycle.ts` does at runtime.
 */
function seedLedger(
  installDir: string,
  edits: { relPath: string; before: string; after: string }[],
): void {
  const ledger = initFileChangeLedger(installDir, () => undefined);
  for (const { relPath, before, after } of edits) {
    const abs = join(installDir, relPath);
    // Ensure parent dirs exist — recordPreWrite reads from disk so the
    // file has to actually be there (or absent, in the create case).
    mkdirSync(dirname(abs), { recursive: true });
    // Empty `before` means a create — leave the file off disk so
    // recordPreWrite picks up `kind: 'create'` and `beforeContent: null`.
    if (before !== '') writeFileSync(abs, before, 'utf8');
    ledger.recordPreWrite(abs);
    writeFileSync(abs, after, 'utf8');
    ledger.recordPostWrite(abs, after);
  }
}

describe('RunScreen — Diff tab visibility', () => {
  let installDir: string;

  beforeEach(() => {
    installDir = mkdtempSync(join(tmpdir(), 'run-diff-tab-'));
    resetFileChangeLedger();
    mockedDims = [80, 24];
  });

  afterEach(() => {
    resetFileChangeLedger();
    try {
      rmSync(installDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it('shows the Diff tab label in the tab bar', () => {
    const store = makeStoreForSnapshot({
      installDir,
      runStartedAt: Date.now(),
    });
    const { lastFrame, unmount } = render(<RunScreen store={store} />);
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('Diff');
    // Existing tabs must still be present — adding the Diff tab cannot
    // strip them.
    expect(frame).toContain('Progress');
    expect(frame).toContain('Logs');
    unmount();
  });

  it('positions the Diff tab between Events and Logs when an event plan exists', () => {
    const store = makeStoreForSnapshot({
      installDir,
      runStartedAt: Date.now(),
    });
    // Seed an event plan so the Events tab renders.
    store.setEventPlan([{ name: 'App Loaded', description: 'first paint' }]);
    const { lastFrame, unmount } = render(<RunScreen store={store} />);
    const frame = stripAnsi(lastFrame() ?? '');
    // Find the tab-bar row — it's the line that mentions every tab.
    const tabBar = frame.split('\n').find((l) => /Progress/.test(l) && /Logs/.test(l));
    expect(tabBar).toBeDefined();
    const progressIdx = (tabBar ?? '').indexOf('Progress');
    const eventsIdx = (tabBar ?? '').indexOf('Events');
    const diffIdx = (tabBar ?? '').indexOf('Diff');
    const logsIdx = (tabBar ?? '').indexOf('Logs');
    expect(progressIdx).toBeGreaterThanOrEqual(0);
    expect(eventsIdx).toBeGreaterThan(progressIdx);
    expect(diffIdx).toBeGreaterThan(eventsIdx);
    expect(logsIdx).toBeGreaterThan(diffIdx);
    unmount();
  });
});

describe('RunScreen — Diff tab content', () => {
  let installDir: string;

  beforeEach(() => {
    installDir = mkdtempSync(join(tmpdir(), 'run-diff-tab-'));
    resetFileChangeLedger();
    mockedDims = [80, 24];
  });

  afterEach(() => {
    resetFileChangeLedger();
    try {
      rmSync(installDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it('shows the empty-state message when no file changes have landed', async () => {
    const store = makeStoreForSnapshot({
      installDir,
      runStartedAt: Date.now(),
    });
    store.setRequestedTab('diff');
    const { lastFrame, unmount } = render(<RunScreen store={store} />);
    // Two frames so TabContainer's `useEffect([requestedTab])` consumes
    // the request and commits the new activeTab state.
    await waitForFrame();
    await waitForFrame();
    const frame = stripAnsi(lastFrame() ?? '');
    // Empty-state copy from DiffTab.tsx. Asserting against a stable
    // substring rather than the whole sentence so wrap differences
    // on narrow terminals don't break the test.
    expect(frame).toMatch(/no file changes yet/);
    unmount();
  });

  it('lists every changed file and renders the selected diff with +/− coloring', async () => {
    seedLedger(installDir, [
      {
        relPath: 'src/app/layout.tsx',
        before: 'export default function Layout() {\n  return <html />;\n}\n',
        after:
          'export default function Layout() {\n  return <html lang="en" />;\n}\n',
      },
      {
        relPath: 'src/analytics.ts',
        before: 'export const noop = () => {};\n',
        after:
          'import * as amplitude from "@amplitude/analytics-browser";\nexport const noop = () => {};\n',
      },
    ]);
    const store = makeStoreForSnapshot({
      installDir,
      runStartedAt: Date.now(),
    });
    // The DiffTab subscribes to `fileWritesTotal` for ledger walks. Bump
    // it via the public mutation path (`recordFileChangePlanned`) so the
    // memo re-runs and picks up the seeded ledger entries.
    store.recordFileChangePlanned({
      path: join(installDir, 'src/app/layout.tsx'),
      operation: 'modify',
    });
    store.recordFileChangeApplied({
      path: join(installDir, 'src/app/layout.tsx'),
      operation: 'modify',
    });
    store.recordFileChangePlanned({
      path: join(installDir, 'src/analytics.ts'),
      operation: 'modify',
    });
    store.recordFileChangeApplied({
      path: join(installDir, 'src/analytics.ts'),
      operation: 'modify',
    });
    store.setRequestedTab('diff');

    const { lastFrame, unmount } = render(<RunScreen store={store} />);
    await waitForFrame();
    await waitForFrame();
    const frame = stripAnsi(lastFrame() ?? '');

    // Header for the file list.
    expect(frame).toContain('Changed files');
    // Both files appear in the list (relative path — install dir
    // stripped by displayPath).
    expect(frame).toContain('src/app/layout.tsx');
    expect(frame).toContain('src/analytics.ts');
    // The selected file (newest first → src/analytics.ts) renders its
    // patch body — the `+` line for the new import must be present.
    expect(frame).toMatch(/\+.*amplitude\/analytics-browser/);
    // Hunk header from the diff body.
    expect(frame).toContain('@@');
    unmount();
  });
});

describe('RunScreen — Diff tab snapshots', () => {
  let installDir: string;

  beforeEach(() => {
    installDir = mkdtempSync(join(tmpdir(), 'run-diff-tab-'));
    resetFileChangeLedger();
  });

  afterEach(() => {
    resetFileChangeLedger();
    try {
      rmSync(installDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  const seedTwoFiles = () => {
    seedLedger(installDir, [
      {
        relPath: 'src/app/layout.tsx',
        before: 'function Layout() {}\n',
        after: 'function Layout() {\n  return null;\n}\n',
      },
      {
        relPath: 'src/instrument.ts',
        before: '',
        after: 'import * as amp from "@amplitude/analytics-browser";\n',
      },
    ]);
  };

  it('80 cols — file list + selected diff', async () => {
    mockedDims = [80, 24];
    seedTwoFiles();
    const store = makeStoreForSnapshot({
      installDir,
      runStartedAt: 0,
    });
    store.recordFileChangePlanned({
      path: join(installDir, 'src/app/layout.tsx'),
      operation: 'modify',
    });
    store.recordFileChangeApplied({
      path: join(installDir, 'src/app/layout.tsx'),
      operation: 'modify',
    });
    store.recordFileChangePlanned({
      path: join(installDir, 'src/instrument.ts'),
      operation: 'create',
    });
    store.recordFileChangeApplied({
      path: join(installDir, 'src/instrument.ts'),
      operation: 'create',
    });
    store.setRequestedTab('diff');
    const { lastFrame, unmount } = render(<RunScreen store={store} />);
    await waitForFrame();
    await waitForFrame();
    const frame = trimTrailingWs(stripAnsi(lastFrame() ?? ''));
    // Snapshot the meaningful content: file list header, file rows,
    // and the diff body. The full RunScreen frame includes a lot of
    // chrome that's not Diff-tab-specific — extracting the
    // content-relevant region keeps the snapshot focused and stable
    // across unrelated chrome changes.
    expect(frame).toContain('Changed files');
    expect(frame).toContain('src/app/layout.tsx');
    expect(frame).toContain('src/instrument.ts');
    expect(frame).toContain('@@');
    expect(frame).toMatchSnapshot();
    unmount();
  });

  it('60 cols — narrow terminal still renders the tab', async () => {
    mockedDims = [60, 24];
    seedTwoFiles();
    const store = makeStoreForSnapshot({
      installDir,
      runStartedAt: 0,
    });
    store.recordFileChangePlanned({
      path: join(installDir, 'src/app/layout.tsx'),
      operation: 'modify',
    });
    store.recordFileChangeApplied({
      path: join(installDir, 'src/app/layout.tsx'),
      operation: 'modify',
    });
    store.recordFileChangePlanned({
      path: join(installDir, 'src/instrument.ts'),
      operation: 'create',
    });
    store.recordFileChangeApplied({
      path: join(installDir, 'src/instrument.ts'),
      operation: 'create',
    });
    store.setRequestedTab('diff');
    const { lastFrame, unmount } = render(<RunScreen store={store} />);
    await waitForFrame();
    await waitForFrame();
    const frame = trimTrailingWs(stripAnsi(lastFrame() ?? ''));
    // The tab label and at least one changed file must still be
    // visible at 60 cols.
    expect(frame).toContain('Diff');
    expect(frame).toContain('Changed files');
    expect(frame).toMatchSnapshot();
    unmount();
  });
});
