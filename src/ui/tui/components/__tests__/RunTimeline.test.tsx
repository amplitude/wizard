/**
 * RunTimeline — vertical composer rendered when WIZARD_NEW_UX=1.
 *
 * Coverage:
 *   1. Snapshots at three widths (80/60/40) so layout responsiveness
 *      stays pinned (extras row gates on cols ≥ 60; ledger trims to 3
 *      rows below cols < 100).
 *   2. No-flicker invariant: when a new file write arrives, the prior
 *      frame's lines must still appear in document order in the new
 *      frame — i.e. the timeline only APPENDS, never re-shuffles
 *      pre-existing rows.
 *
 * Width is controlled by `ink-testing-library`'s `columns` option so
 * tests are deterministic on any host.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { WizardStore } from '../../store.js';
import { TaskStatus } from '../../../wizard-ui.js';
import { RunTimeline } from '../RunTimeline.js';

// Strip ANSI for human-readable snapshots / line scans.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const sanitize = (s: string): string =>
  s
    .replace(ANSI, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n');

/** Pin runStartedAt and tasks so the rendered frame is deterministic. */
function makeStore(): WizardStore {
  const store = new WizardStore();
  store.session = {
    ...store.session,
    installDir: '/tmp/wizard-tl-test',
    runStartedAt: Date.now() - 47_000, // → "elapsed 47s"
  };
  store.setTasks([
    {
      label: 'Detect framework',
      activeForm: 'Detecting framework',
      status: TaskStatus.Completed,
      done: true,
    },
    {
      label: 'Wire up SDK',
      activeForm: 'Wiring up SDK',
      status: TaskStatus.InProgress,
      done: false,
    },
    {
      label: 'Confirm event plan',
      activeForm: 'Confirming event plan',
      status: TaskStatus.Pending,
      done: false,
    },
    {
      label: 'Save events',
      activeForm: 'Saving events',
      status: TaskStatus.Pending,
      done: false,
    },
    {
      label: 'Build starter dashboard',
      activeForm: 'Building starter dashboard',
      status: TaskStatus.Pending,
      done: false,
    },
  ]);
  store.pushStatus('Reading project structure');
  store.recordFileChangePlanned({
    path: '/tmp/wizard-tl-test/src/amplitude.ts',
    operation: 'create',
  });
  store.recordFileChangeApplied({
    path: '/tmp/wizard-tl-test/src/amplitude.ts',
    operation: 'create',
    bytes: 512,
  });
  store.recordFileChangePlanned({
    path: '/tmp/wizard-tl-test/app/layout.tsx',
    operation: 'modify',
  });
  store.recordFileChangeApplied({
    path: '/tmp/wizard-tl-test/app/layout.tsx',
    operation: 'modify',
    bytes: 128,
  });
  return store;
}

describe('RunTimeline (WIZARD_NEW_UX=1)', () => {
  beforeEach(() => {
    // Pin locale so glyph mode is deterministic across hosts.
    vi.stubEnv('LANG', 'en_US.UTF-8');
    vi.stubEnv('LC_ALL', '');
    vi.stubEnv('LC_CTYPE', '');
    vi.stubEnv('WIZARD_FORCE_ASCII', '');
    // Freeze "now" so elapsed is stable across CI runs.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:47Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('renders at 80 cols', () => {
    const store = makeStore();
    // Use the frozen Date.now() − 47s to pin the elapsed counter to 47s.
    store.session = { ...store.session, runStartedAt: Date.now() - 47_000 };
    const { lastFrame, unmount } = render(<RunTimeline store={store} />, {
      stdout: { columns: 80 } as never,
    });
    expect(sanitize(lastFrame() ?? '')).toMatchSnapshot();
    unmount();
  });

  it('renders at 60 cols (extras row threshold)', () => {
    const store = makeStore();
    store.session = { ...store.session, runStartedAt: Date.now() - 47_000 };
    const { lastFrame, unmount } = render(<RunTimeline store={store} />, {
      stdout: { columns: 60 } as never,
    });
    expect(sanitize(lastFrame() ?? '')).toMatchSnapshot();
    unmount();
  });

  it('renders at 40 cols (no extras row, narrow ledger)', () => {
    const store = makeStore();
    store.session = { ...store.session, runStartedAt: Date.now() - 47_000 };
    const { lastFrame, unmount } = render(<RunTimeline store={store} />, {
      stdout: { columns: 40 } as never,
    });
    expect(sanitize(lastFrame() ?? '')).toMatchSnapshot();
    unmount();
  });

  it('append-only: prior task/ledger lines stay present after a new file write', () => {
    const store = makeStore();
    store.session = { ...store.session, runStartedAt: Date.now() - 47_000 };
    const { lastFrame, rerender, unmount } = render(<RunTimeline store={store} />, {
      stdout: { columns: 100 } as never,
    });

    const before = sanitize(lastFrame() ?? '');
    const beforeLines = before.split('\n').filter((l) => l.trim().length > 0);

    // Agent tick: a new file write lands.
    store.recordFileChangePlanned({
      path: '/tmp/wizard-tl-test/.env.local',
      operation: 'modify',
    });
    store.recordFileChangeApplied({
      path: '/tmp/wizard-tl-test/.env.local',
      operation: 'modify',
      bytes: 64,
    });
    rerender(<RunTimeline store={store} />);

    const after = sanitize(lastFrame() ?? '');
    const afterLines = after.split('\n');

    // Every non-empty line that existed before must still appear, in
    // document order. This is the "no flicker / no re-shuffle" check —
    // file-write rows append-only.
    let cursor = 0;
    for (const line of beforeLines) {
      const idx = afterLines.indexOf(line, cursor);
      expect(
        idx,
        `previous line "${line}" missing or reordered in new frame:\n${after}`,
      ).toBeGreaterThanOrEqual(cursor);
      cursor = idx + 1;
    }

    // And the new file shows up.
    expect(after).toContain('.env.local');
    unmount();
  });
});
