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
// 120s headroom — the prior 60s value was reproducibly tripping the
// pre-push hook even though every test passes when run in isolation.
// Solo, this file finishes in ~4s; the cost of bumping is 0 on healthy
// runs (the timeout is only consulted when a test actually hangs).
const SLOW_TEST_TIMEOUT_MS = 120_000;

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
      // Mark the existing task completed (the high-water-marked completed
      // counter is part of the new progressSignal; appending alone after
      // #347 doesn't happen in production since the TodoWrite list is
      // locked at 5 todos, but the completion path absolutely does).
      store.setTasks([
        {
          ...store.tasks[0],
          status: TaskStatus.Completed,
          done: true,
        },
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

  it(
    'resets coaching when a new status message arrives (post-#347 reality)',
    async () => {
      // After #347 the TodoWrite list is locked at exactly 5 todos. The agent
      // never appends new tasks during a run — so the prior `progressSignal:
      // total` never changed, and coaching escalated on schedule even when
      // the agent was actively shipping [STATUS] updates. This test pins the
      // fix: a streaming status message counts as forward progress and
      // resets the coaching timer, exactly like a task completion does.
      const store = seedRunScreenStore();
      const { lastFrame, rerender } = render(<RunScreen store={store} />);
      await vi.advanceTimersByTimeAsync(95_000);
      expect(lastFrame() ?? '').toContain('Still working');

      // Agent emits a new status — every active step does this every few
      // seconds. The timer must reset.
      store.pushStatus('Reading package.json');
      rerender(<RunScreen store={store} />);

      await vi.advanceTimersByTimeAsync(2_000);
      expect(lastFrame() ?? '').not.toContain('Still working');
    },
    SLOW_TEST_TIMEOUT_MS,
  );

  it(
    'resets coaching when a file write is recorded (forward progress)',
    async () => {
      // Third progressSignal source: PreToolUse(Write|Edit) hooks fire as
      // the agent edits user files. Each one is unambiguous "the agent is
      // doing something the user can see" — must reset the coaching timer.
      const store = seedRunScreenStore();
      const { lastFrame, rerender } = render(<RunScreen store={store} />);
      await vi.advanceTimersByTimeAsync(95_000);
      expect(lastFrame() ?? '').toContain('Still working');

      store.recordFileChangePlanned({
        path: '/tmp/fake/src/amplitude.ts',
        operation: 'create',
      });
      rerender(<RunScreen store={store} />);

      await vi.advanceTimersByTimeAsync(2_000);
      expect(lastFrame() ?? '').not.toContain('Still working');
    },
    SLOW_TEST_TIMEOUT_MS,
  );

  it(
    'does NOT escalate to "unusually slow" when the agent is steadily streaming status (5+ minute run, healthy)',
    async () => {
      // Regression guard for the #347 interaction: pre-fix, EVERY 5-minute
      // run triggered the tier-2 "This is unusually slow" line because
      // `progressSignal: total` never changed. Calling a normal-length run
      // unusually slow undermines user trust. This test simulates a healthy
      // 5-minute run with a status update every 30 seconds and pins that
      // the tier-2 line never appears.
      const store = seedRunScreenStore();
      const { lastFrame, rerender } = render(<RunScreen store={store} />);

      for (let i = 0; i < 11; i++) {
        await vi.advanceTimersByTimeAsync(30_000);
        store.pushStatus(`Working on step ${i + 1}`);
        rerender(<RunScreen store={store} />);
      }
      // Total elapsed: 330 s; well past the 300 s tier-2 threshold.
      expect(lastFrame() ?? '').not.toContain('unusually slow');
    },
    SLOW_TEST_TIMEOUT_MS,
  );
});
