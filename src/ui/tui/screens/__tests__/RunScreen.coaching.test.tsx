/**
 * RunScreen coaching tiers — verifies the "spinner spins forever" copy
 * appears at the right times and resets when a new task arrives.
 *
 * The hero of this screen is the task list. Coaching is intentionally a
 * secondary muted line — it should never replace the spinner.
 *
 * Why the SPINNER_INTERVAL mock below: the real RunScreen ticks a 200ms
 * spinner on top of the 1Hz coaching timer. Advancing fake timers across
 * 95–305 simulated seconds otherwise fires ~475–1525 spinner ticks, each
 * triggering a React re-render of the entire RunScreen tree (logs tab,
 * journey stepper, etc). Under parallel-test load on a busy machine the
 * cascading re-render work consistently exceeded the 30 s test timeout.
 *
 * Pinning SPINNER_INTERVAL high makes the spinner effectively dormant
 * during the test; the only timer the test cares about is the coaching
 * 1Hz tick. The spinner code path is still exercised — it just doesn't
 * fire mid-test.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../styles.js', async (importActual) => {
  const actual = await importActual<typeof import('../../styles.js')>();
  return {
    ...actual,
    // 1 hour — well outside the largest timer we advance in any test.
    SPINNER_INTERVAL: 60 * 60 * 1000,
  };
});

import { render } from 'ink-testing-library';
import { RunScreen } from '../RunScreen.js';
import { makeStoreForSnapshot } from '../../__tests__/snapshot-utils.js';
import { TaskStatus } from '../../../wizard-ui.js';

function seedRunScreenStore() {
  const store = makeStoreForSnapshot({ runStartedAt: Date.now() });
  store.setTasks([
    {
      label: 'Install SDK',
      activeForm: 'Installing SDK...',
      status: TaskStatus.InProgress,
      done: false,
    },
  ]);
  return store;
}

// RunScreen has a high-frequency spinner setInterval (~80ms ticks) on
// top of the per-second coaching timer. Advancing fake timers across
// 90–305s flushes many React renders; bump the per-test timeout
// generously to absorb that on slower CI hardware.
//
// Headroom note: in isolation this test runs in ~4s. Under heavy
// parallel-suite load, the import + render phase has been seen to
// stretch past 30s. Keep the ceiling generous so CI doesn't
// false-positive on machine load that has nothing to do with the
// behaviour being tested.
const SLOW_TEST_TIMEOUT_MS = 60_000;

describe('RunScreen — timeout coaching', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not show coaching copy on the initial frame', () => {
    const store = seedRunScreenStore();
    const { lastFrame } = render(<RunScreen store={store} />);
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('Still working');
    expect(frame).not.toContain('unusually slow');
  });

  it(
    'shows the tier-1 coaching line after 90s of no task changes',
    async () => {
      const store = seedRunScreenStore();
      const { lastFrame } = render(<RunScreen store={store} />);

      await vi.advanceTimersByTimeAsync(95_000);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('Still working');
      expect(frame).toContain('Logs tab');
    },
    SLOW_TEST_TIMEOUT_MS,
  );

  it(
    'escalates to the tier-2 line past 5 minutes',
    async () => {
      const store = seedRunScreenStore();
      const { lastFrame } = render(<RunScreen store={store} />);

      await vi.advanceTimersByTimeAsync(305_000);
      const frame = lastFrame() ?? '';
      expect(frame).toContain('unusually slow');
    },
    SLOW_TEST_TIMEOUT_MS,
  );

  it(
    'resets coaching when a new task is appended (forward progress)',
    async () => {
      const store = seedRunScreenStore();
      const { lastFrame, rerender } = render(<RunScreen store={store} />);
      await vi.advanceTimersByTimeAsync(95_000);
      expect(lastFrame() ?? '').toContain('Still working');

      // Agent reports a new task — that's forward motion. Reset the counter.
      store.setTasks([
        ...store.tasks,
        {
          label: 'Configure events',
          activeForm: 'Configuring events...',
          status: TaskStatus.Pending,
          done: false,
        },
      ]);
      rerender(<RunScreen store={store} />);

      await vi.advanceTimersByTimeAsync(2_000);
      expect(lastFrame() ?? '').not.toContain('Still working');
    },
    SLOW_TEST_TIMEOUT_MS,
  );
});
