/**
 * RunScreen coaching tiers — verifies the "spinner spins forever" copy
 * appears at the right times and resets when a new task arrives.
 *
 * The hero of this screen is the task list. Coaching is intentionally a
 * secondary muted line — it should never replace the spinner.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

  it('shows the tier-1 coaching line after 90s of no task changes', async () => {
    const store = seedRunScreenStore();
    const { lastFrame } = render(<RunScreen store={store} />);

    await vi.advanceTimersByTimeAsync(95_000);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Still working');
    expect(frame).toContain('Logs tab');
  });

  it('escalates to the tier-2 line past 5 minutes', async () => {
    const store = seedRunScreenStore();
    const { lastFrame } = render(<RunScreen store={store} />);

    await vi.advanceTimersByTimeAsync(305_000);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('unusually slow');
  });

  it('resets coaching when a new task is appended (forward progress)', async () => {
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
  });
});
