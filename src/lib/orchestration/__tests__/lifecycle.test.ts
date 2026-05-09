/**
 * Lifecycle transition validator — exhaustive contract tests.
 *
 * The transition surface is part of the public orchestration contract; PRs
 * 2 and 3 will start writing to many more sites. These tests pin every
 * legal transition AND every illegal transition so a regression that loosens
 * the validator (or flips an arrow the wrong direction) surfaces as a clean
 * test failure rather than corrupt store data.
 */
import { describe, it, expect } from 'vitest';

import {
  TaskLifecycle,
  canTransition,
  assertTransition,
  isTerminal,
  isActive,
  IllegalTaskTransitionError,
} from '../lifecycle';

const ALL_STATES: TaskLifecycle[] = Object.values(TaskLifecycle);

const LEGAL: Array<[TaskLifecycle, TaskLifecycle]> = [
  // queued → ...
  [TaskLifecycle.Queued, TaskLifecycle.Running],
  [TaskLifecycle.Queued, TaskLifecycle.Cancelled],
  [TaskLifecycle.Queued, TaskLifecycle.Superseded],
  // running → ...
  [TaskLifecycle.Running, TaskLifecycle.WaitingForUser],
  [TaskLifecycle.Running, TaskLifecycle.Blocked],
  [TaskLifecycle.Running, TaskLifecycle.Completed],
  [TaskLifecycle.Running, TaskLifecycle.Failed],
  [TaskLifecycle.Running, TaskLifecycle.Cancelled],
  [TaskLifecycle.Running, TaskLifecycle.Superseded],
  // waiting_for_user → ...
  [TaskLifecycle.WaitingForUser, TaskLifecycle.Running],
  [TaskLifecycle.WaitingForUser, TaskLifecycle.Completed],
  [TaskLifecycle.WaitingForUser, TaskLifecycle.Failed],
  [TaskLifecycle.WaitingForUser, TaskLifecycle.Cancelled],
  [TaskLifecycle.WaitingForUser, TaskLifecycle.Superseded],
  // blocked → ...
  [TaskLifecycle.Blocked, TaskLifecycle.Running],
  [TaskLifecycle.Blocked, TaskLifecycle.Failed],
  [TaskLifecycle.Blocked, TaskLifecycle.Cancelled],
  [TaskLifecycle.Blocked, TaskLifecycle.Superseded],
];

describe('TaskLifecycle.canTransition', () => {
  it('every documented legal transition is allowed', () => {
    for (const [from, to] of LEGAL) {
      expect(canTransition(from, to)).toBe(true);
    }
  });

  it('identity transitions are rejected (callers must short-circuit no-ops)', () => {
    for (const s of ALL_STATES) {
      expect(canTransition(s, s)).toBe(false);
    }
  });

  it('terminal states have no outbound transitions', () => {
    const terminals: TaskLifecycle[] = [
      TaskLifecycle.Completed,
      TaskLifecycle.Failed,
      TaskLifecycle.Cancelled,
      TaskLifecycle.Superseded,
    ];
    for (const t of terminals) {
      for (const to of ALL_STATES) {
        expect(canTransition(t, to)).toBe(false);
      }
    }
  });

  it('queued cannot directly skip to a terminal completion (must run first)', () => {
    expect(canTransition(TaskLifecycle.Queued, TaskLifecycle.Completed)).toBe(
      false,
    );
    expect(canTransition(TaskLifecycle.Queued, TaskLifecycle.Failed)).toBe(
      false,
    );
    // ...but cancellation is fine — a queued task can be cancelled before it
    // ever runs (e.g. user aborts during setup).
    expect(canTransition(TaskLifecycle.Queued, TaskLifecycle.Cancelled)).toBe(
      true,
    );
  });

  it('blocked cannot directly transition to completed (must un-block first)', () => {
    expect(canTransition(TaskLifecycle.Blocked, TaskLifecycle.Completed)).toBe(
      false,
    );
  });

  it('exhaustive matrix matches LEGAL set exactly', () => {
    const legalSet = new Set(LEGAL.map(([f, t]) => `${f}->${t}`));
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        const expected = legalSet.has(`${from}->${to}`);
        expect(canTransition(from, to)).toBe(expected);
      }
    }
  });
});

describe('TaskLifecycle.assertTransition', () => {
  it('does not throw on legal transitions', () => {
    for (const [from, to] of LEGAL) {
      expect(() => assertTransition('task_x', from, to)).not.toThrow();
    }
  });

  it('throws IllegalTaskTransitionError with a useful message on illegal transitions', () => {
    expect(() =>
      assertTransition(
        'task_abc',
        TaskLifecycle.Completed,
        TaskLifecycle.Running,
      ),
    ).toThrow(IllegalTaskTransitionError);
    try {
      assertTransition(
        'task_abc',
        TaskLifecycle.Completed,
        TaskLifecycle.Running,
      );
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalTaskTransitionError);
      const e = err as IllegalTaskTransitionError;
      expect(e.taskId).toBe('task_abc');
      expect(e.from).toBe(TaskLifecycle.Completed);
      expect(e.to).toBe(TaskLifecycle.Running);
      expect(e.message).toMatch(/already terminal/);
    }
  });
});

describe('TaskLifecycle.isTerminal / isActive', () => {
  it('classifies terminals correctly', () => {
    expect(isTerminal(TaskLifecycle.Completed)).toBe(true);
    expect(isTerminal(TaskLifecycle.Failed)).toBe(true);
    expect(isTerminal(TaskLifecycle.Cancelled)).toBe(true);
    expect(isTerminal(TaskLifecycle.Superseded)).toBe(true);
    expect(isTerminal(TaskLifecycle.Running)).toBe(false);
    expect(isTerminal(TaskLifecycle.Queued)).toBe(false);
    expect(isTerminal(TaskLifecycle.WaitingForUser)).toBe(false);
    expect(isTerminal(TaskLifecycle.Blocked)).toBe(false);
  });

  it('classifies active states correctly', () => {
    expect(isActive(TaskLifecycle.Running)).toBe(true);
    expect(isActive(TaskLifecycle.WaitingForUser)).toBe(true);
    expect(isActive(TaskLifecycle.Blocked)).toBe(true);
    expect(isActive(TaskLifecycle.Queued)).toBe(false);
    expect(isActive(TaskLifecycle.Completed)).toBe(false);
  });
});
