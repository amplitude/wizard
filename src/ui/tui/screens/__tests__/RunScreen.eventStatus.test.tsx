/**
 * RunScreen — per-event wiring status list.
 *
 * Replaces the truncated `Events: foo, bar, baz, …` line with a
 * vertical row-per-event list during the Wiring step. Pins:
 *   - 5 pending events render as 5 rows with the `○` glyph.
 *   - After 2 are marked `done`, those rows show `✓` and the counter
 *     reads "2 done · 3 to go".
 *   - On terminals < MIN_COLS_FOR_EVENT_LIST cols the list collapses
 *     to the legacy compact comma-separated form so the bottom
 *     status pill stays on-screen.
 *
 * Why mock SPINNER_INTERVAL: the live 200ms interval re-renders the
 * tree dozens of times per test, which can blow vitest's timeout
 * under CI load. A single static frame is enough for content
 * assertions.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../styles.js', async (importActual) => {
  const actual = await importActual<typeof import('../../styles.js')>();
  return {
    ...actual,
    SPINNER_INTERVAL: 60 * 60 * 1000,
  };
});

let mockedDims: [number, number] = [100, 24];
vi.mock('../../hooks/useStdoutDimensions.js', () => ({
  useStdoutDimensions: () => mockedDims,
}));

import { render } from 'ink-testing-library';
import { RunScreen } from '../RunScreen.js';
import { makeStoreForSnapshot } from '../../__tests__/snapshot-utils.js';
import { TaskStatus } from '../../../wizard-ui.js';

// eslint-disable-next-line no-control-regex
const ANSI_CSI_REGEX = /\x1b\[[0-9;]*[A-Za-z]/g;
// eslint-disable-next-line no-control-regex
const ANSI_OSC_REGEX = /\x1b\][^\x07]*\x07/g;
const stripAnsi = (s: string): string =>
  s.replace(ANSI_CSI_REGEX, '').replace(ANSI_OSC_REGEX, '');

function seedStoreWithWiring() {
  const store = makeStoreForSnapshot({
    runStartedAt: Date.now() - 30_000,
  });
  store.setTasks([
    {
      label: 'Detect your project setup',
      activeForm: 'Detecting your project setup',
      status: TaskStatus.Completed,
      done: true,
    },
    {
      label: 'Install Amplitude',
      activeForm: 'Installing Amplitude',
      status: TaskStatus.Completed,
      done: true,
    },
    {
      label: 'Plan and approve events to track',
      activeForm: 'Planning events',
      status: TaskStatus.Completed,
      done: true,
    },
    {
      label: 'Wire up event tracking',
      activeForm: 'Wiring up event tracking',
      status: TaskStatus.InProgress,
      done: false,
    },
  ]);
  return store;
}

describe('RunScreen — per-event wiring status list', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedDims = [100, 24];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders 5 pending events as 5 rows with the ○ glyph', () => {
    const store = seedStoreWithWiring();
    store.setEventPlan([
      { name: 'User Signed Up', description: 'On signup' },
      { name: 'User Signed In', description: 'On login' },
      { name: 'User Signed Out', description: 'On logout' },
      { name: 'Order Completed', description: 'On checkout' },
      { name: 'Product Viewed', description: 'On PDP load' },
    ]);

    const { lastFrame, unmount } = render(<RunScreen store={store} />);
    const frame = stripAnsi(lastFrame() ?? '');
    unmount();

    expect(frame).toContain('Events');

    // Counter header: 0 done, 5 to go.
    expect(frame).toContain('0 done');
    expect(frame).toContain('5 to go');

    // Each event renders on its own row with the open-bullet glyph.
    const lines = frame.split('\n');
    for (const name of [
      'User Signed Up',
      'User Signed In',
      'User Signed Out',
      'Order Completed',
      'Product Viewed',
    ]) {
      const row = lines.find((l) => l.includes(name));
      expect(row, `expected a row for "${name}"`).toBeDefined();
      expect(row).toContain('○');
    }

    // The previous comma-separated form is no longer present at this width.
    const compactRow = lines.find(
      (l) => l.includes('Events:') && l.includes(','),
    );
    expect(compactRow).toBeUndefined();
  });

  it('marks 2 events as ✓ done and updates the counter to "2 done · 3 to go"', () => {
    const store = seedStoreWithWiring();
    store.setEventPlan([
      { name: 'User Signed Up', description: '' },
      { name: 'User Signed In', description: '' },
      { name: 'User Signed Out', description: '' },
      { name: 'Order Completed', description: '' },
      { name: 'Product Viewed', description: '' },
    ]);
    store.markEventStatus('User Signed Up', 'done');
    store.markEventStatus('User Signed In', 'done');

    const { lastFrame, unmount } = render(<RunScreen store={store} />);
    const frame = stripAnsi(lastFrame() ?? '');
    unmount();

    expect(frame).toContain('2 done');
    expect(frame).toContain('3 to go');

    const lines = frame.split('\n');
    const doneRows = [
      lines.find((l) => l.includes('User Signed Up')),
      lines.find((l) => l.includes('User Signed In')),
    ];
    for (const row of doneRows) {
      expect(row).toBeDefined();
      expect(row).toContain('✓');
    }
    const pendingRow = lines.find((l) => l.includes('Order Completed'));
    expect(pendingRow).toBeDefined();
    expect(pendingRow).toContain('○');
  });

  it('shows `›` glyph for an in_progress event', () => {
    const store = seedStoreWithWiring();
    store.setEventPlan([
      { name: 'User Signed Up', description: '' },
      { name: 'User Signed In', description: '' },
    ]);
    store.markEventStatus('User Signed In', 'in_progress');

    const { lastFrame, unmount } = render(<RunScreen store={store} />);
    const frame = stripAnsi(lastFrame() ?? '');
    unmount();

    const lines = frame.split('\n');
    const activeRow = lines.find((l) => l.includes('User Signed In'));
    expect(activeRow).toBeDefined();
    expect(activeRow).toContain('›');
  });

  it('falls back to compact comma-separated form on narrow (<60 cols) terminals', () => {
    mockedDims = [50, 24];
    const store = seedStoreWithWiring();
    store.setEventPlan([
      { name: 'User Signed Up', description: '' },
      { name: 'User Signed In', description: '' },
      { name: 'Order Completed', description: '' },
    ]);

    const { lastFrame, unmount } = render(<RunScreen store={store} />);
    const frame = stripAnsi(lastFrame() ?? '');
    unmount();

    // Compact fallback: a single "Events:" row with comma-joined names
    // (truncated to fit, but the row exists).
    const lines = frame.split('\n');
    const compactRow = lines.find((l) => l.includes('Events:'));
    expect(compactRow).toBeDefined();
    // The legacy compact row shows the comma-separated names.
    expect(compactRow).toMatch(/User Signed Up.*User Signed In/);

    // No per-event status rows on the narrow fallback — the legacy
    // line doesn't decompose into per-event rows. Verify by checking
    // that none of the event names appear on a row that ALSO carries
    // a status glyph (○ ✓ › ✗) on its own (the compact row has all
    // names jammed together with commas, no per-row glyphs).
    const perEventRow = lines.find(
      (l) =>
        /[○✓›✗]/.test(l) &&
        l.includes('User Signed Up') &&
        !l.includes(','),
    );
    expect(perEventRow).toBeUndefined();
  });
});
