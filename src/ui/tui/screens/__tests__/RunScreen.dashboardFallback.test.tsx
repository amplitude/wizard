/**
 * RunScreen — dashboard fallback synthetic 6th task.
 *
 * The agent's TodoWrite list is locked at exactly five items
 * (commandments.ts forbids a sixth). When the in-loop agent skips its
 * dashboard work and the post-agent `createDashboardStep` runs as a
 * fallback, the spinner header would otherwise read "5 / 5 tasks
 * complete" for the duration of the fallback — the user-visible bug
 * this PR fixes.
 *
 * The fix: surface a synthetic 6th task driven by
 * `session.dashboardFallbackPhase`. These tests pin the rendering
 * contract: the row appears only when the fallback is in progress, and
 * the header counter reflects six tasks during that window.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../styles.js', async (importActual) => {
  const actual = await importActual<typeof import('../../styles.js')>();
  return {
    ...actual,
    SPINNER_INTERVAL: 60 * 60 * 1000, // see RunScreen.coaching.test.tsx
  };
});

import { render } from 'ink-testing-library';
import { RunScreen } from '../RunScreen.js';
import { makeStoreForSnapshot } from '../../__tests__/snapshot-utils.js';
import { TaskStatus } from '../../../wizard-ui.js';

function seedFiveCompletedTasks() {
  const store = makeStoreForSnapshot({ runStartedAt: Date.now() });
  store.setTasks([
    { label: 'Detect your project setup', activeForm: 'Detecting...', status: TaskStatus.Completed, done: true },
    { label: 'Install Amplitude', activeForm: 'Installing...', status: TaskStatus.Completed, done: true },
    { label: 'Plan and approve events to track', activeForm: 'Planning...', status: TaskStatus.Completed, done: true },
    { label: 'Wire up event tracking', activeForm: 'Wiring...', status: TaskStatus.Completed, done: true },
    { label: 'Open your dashboard', activeForm: 'Opening...', status: TaskStatus.Completed, done: true },
  ]);
  return store;
}

describe('RunScreen — dashboard fallback synthetic 6th task', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does NOT render the 6th task on a healthy run (phase=null)', () => {
    const store = seedFiveCompletedTasks();
    // Phase stays null — the agent recorded the dashboard via
    // record_dashboard, fallback never fires.
    expect(store.session.dashboardFallbackPhase ?? null).toBeNull();
    const { lastFrame } = render(<RunScreen store={store} />);
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('Create your starter dashboard');
    expect(frame).not.toContain('Creating your starter dashboard');
    // Header reflects exactly 5 completed.
    expect(frame).toContain('5 tasks complete');
  });

  it('renders the 6th task in_progress while phase=in_progress', () => {
    const store = seedFiveCompletedTasks();
    store.session = {
      ...store.session,
      dashboardFallbackPhase: 'in_progress',
    };
    const { lastFrame } = render(<RunScreen store={store} />);
    const frame = lastFrame() ?? '';
    // The active form (in_progress) is what shows in the row.
    expect(frame).toContain('Creating your starter dashboard');
    // Header now counts 5 done out of 6 total — no longer reads
    // "5 tasks complete" because the to-go count is non-zero.
    expect(frame).not.toMatch(/5 tasks complete/);
    expect(frame).toContain('5 done');
    expect(frame).toContain('1 to go');
  });

  it('drops the 6th task once phase=completed', () => {
    const store = seedFiveCompletedTasks();
    store.session = {
      ...store.session,
      dashboardFallbackPhase: 'completed',
    };
    const { lastFrame } = render(<RunScreen store={store} />);
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('Creating your starter dashboard');
    expect(frame).not.toContain('Create your starter dashboard');
    expect(frame).toContain('5 tasks complete');
  });
});
