/**
 * Pure helper coverage for the "Last activity / Step" footer on the
 * error outro. The visual integration is covered separately in
 * OutroScreen.error.test.tsx — these tests pin the input → output
 * contract so future refactors can't quietly drop the resolution
 * order (in_progress beats completed, latest wins, pending hides).
 */

import { describe, it, expect } from 'vitest';
import {
  buildLastActivityFooter,
  formatClockTime,
} from '../outro-last-activity.js';
import { TaskStatus } from '../../../wizard-ui.js';
import type { TaskItem } from '../../store.js';

const task = (
  label: string,
  status: TaskStatus = TaskStatus.Pending,
): TaskItem => ({
  label,
  status,
  done: status === TaskStatus.Completed,
});

describe('formatClockTime', () => {
  it('returns zero-padded 24h HH:MM:SS for a known timestamp', () => {
    // 2024-01-02T03:04:05 local time — we don't pin the timezone here
    // because the helper is intentionally locale-agnostic; we assert
    // the shape, not the absolute value.
    const out = formatClockTime(Date.parse('2024-01-02T03:04:05'));
    expect(out).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('zero-pads single-digit hours / minutes / seconds', () => {
    // Construct a date that rolls into a single-digit slot to verify
    // padding without depending on the host timezone offset.
    const d = new Date(2024, 0, 1, 9, 5, 3);
    expect(formatClockTime(d.getTime())).toBe('09:05:03');
  });

  it('renders midnight as 00:00:00', () => {
    const d = new Date(2024, 0, 1, 0, 0, 0);
    expect(formatClockTime(d.getTime())).toBe('00:00:00');
  });
});

describe('buildLastActivityFooter', () => {
  it('returns null when runStartedAt is null', () => {
    expect(
      buildLastActivityFooter({
        runStartedAt: null,
        tasks: [task('Detect', TaskStatus.InProgress)],
      }),
    ).toBeNull();
  });

  it('returns null when every task is still pending', () => {
    expect(
      buildLastActivityFooter({
        runStartedAt: Date.now(),
        tasks: [task('Detect'), task('Install'), task('Plan'), task('Wire')],
      }),
    ).toBeNull();
  });

  it('returns null with an empty task list', () => {
    expect(
      buildLastActivityFooter({
        runStartedAt: Date.now(),
        tasks: [],
      }),
    ).toBeNull();
  });

  it('returns the latest in_progress task when one is active', () => {
    const out = buildLastActivityFooter({
      runStartedAt: new Date(2024, 0, 1, 14, 23, 47).getTime(),
      tasks: [
        task('Detect', TaskStatus.Completed),
        task('Install', TaskStatus.InProgress),
        task('Plan'),
        task('Wire'),
      ],
    });
    expect(out).not.toBeNull();
    expect(out!.stepLabel).toBe('Install');
    expect(out!.startedAt).toBe('14:23:47');
  });

  it('falls back to the most-recent completed task when nothing is in_progress', () => {
    const out = buildLastActivityFooter({
      runStartedAt: new Date(2024, 0, 1, 9, 0, 0).getTime(),
      tasks: [
        task('Detect', TaskStatus.Completed),
        task('Install', TaskStatus.Completed),
        task('Plan'),
        task('Wire'),
      ],
    });
    expect(out).not.toBeNull();
    expect(out!.stepLabel).toBe('Install');
  });

  it('prefers in_progress over a later completed (defensive — sequential cascade)', () => {
    // The renderJourneyTasks cascade in store.ts shouldn't produce this
    // shape today, but the helper should still resolve sanely.
    const out = buildLastActivityFooter({
      runStartedAt: 0,
      tasks: [
        task('Detect', TaskStatus.InProgress),
        task('Install', TaskStatus.Completed),
      ],
    });
    expect(out!.stepLabel).toBe('Detect');
  });

  it('walks from the tail so the LATEST matching task wins', () => {
    const out = buildLastActivityFooter({
      runStartedAt: 0,
      tasks: [
        task('Detect', TaskStatus.Completed),
        task('Install', TaskStatus.Completed),
        task('Plan', TaskStatus.Completed),
        task('Wire'),
      ],
    });
    expect(out!.stepLabel).toBe('Plan');
  });
});
