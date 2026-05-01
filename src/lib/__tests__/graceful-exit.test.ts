import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock checkpoint to avoid actual disk writes.
const mockSaveCheckpoint = vi.fn();
vi.mock('../session-checkpoint.js', () => ({
  saveCheckpoint: (...args: unknown[]) => mockSaveCheckpoint(...args),
}));

// Mock analytics flush.
const mockFlush = vi.fn().mockResolvedValue(undefined);
vi.mock('../../utils/analytics.js', () => ({
  analytics: {
    flush: () => mockFlush(),
  },
}));

import {
  performGracefulExit,
  _resetGracefulExitForTests,
  _isGracefulExitInProgressForTests,
} from '../graceful-exit';
import {
  getWizardAbortSignal,
  resetWizardAbortController,
} from '../../utils/wizard-abort';
import type { WizardSession } from '../wizard-session';

function makeCtx(): {
  session: WizardSession;
  setCommandFeedback: ReturnType<typeof vi.fn>;
} {
  return {
    session: { installDir: '/tmp/test' } as unknown as WizardSession,
    setCommandFeedback: vi.fn(),
  };
}

describe('performGracefulExit', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    _resetGracefulExitForTests();
    resetWizardAbortController();
    mockSaveCheckpoint.mockReset();
    mockFlush.mockReset().mockResolvedValue(undefined);
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((_code?: number) => undefined) as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    exitSpy.mockRestore();
  });

  it('aborts the wizard-wide signal before the grace timer fires', () => {
    const ctx = makeCtx();
    const signal = getWizardAbortSignal();
    expect(signal.aborted).toBe(false);

    performGracefulExit(ctx);

    // Abort should fire synchronously, before the 2s grace timer.
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe('user cancelled');
    expect(exitSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2_000);
    expect(exitSpy).toHaveBeenCalledWith(130);
  });

  it('saves a checkpoint and flushes analytics during the grace window', () => {
    const ctx = makeCtx();
    performGracefulExit(ctx);
    expect(mockSaveCheckpoint).toHaveBeenCalledTimes(1);
    expect(mockSaveCheckpoint).toHaveBeenCalledWith(ctx.session);
    expect(mockFlush).toHaveBeenCalledTimes(1);
    expect(ctx.setCommandFeedback).toHaveBeenCalledWith(
      'Saving session… press Ctrl+C again to force quit.',
      10_000,
    );
  });

  it('is idempotent — a second call is a no-op (no double-flush, no double-timer)', () => {
    const ctx = makeCtx();
    performGracefulExit(ctx);
    expect(_isGracefulExitInProgressForTests()).toBe(true);

    // Second call simulates SIGINT firing after Ink's Ctrl+C path already
    // started. Should not re-run any of the cleanup steps.
    performGracefulExit(ctx);

    expect(mockSaveCheckpoint).toHaveBeenCalledTimes(1);
    expect(mockFlush).toHaveBeenCalledTimes(1);
    expect(ctx.setCommandFeedback).toHaveBeenCalledTimes(1);

    // Advance past the 2s window: only one process.exit call should fire,
    // not two (one per setTimeout).
    vi.advanceTimersByTime(2_000);
    expect(exitSpy).toHaveBeenCalledTimes(1);
  });

  it('still exits when setCommandFeedback throws (UI mid-teardown)', () => {
    const ctx = makeCtx();
    ctx.setCommandFeedback.mockImplementation(() => {
      throw new Error('store closed');
    });

    expect(() => performGracefulExit(ctx)).not.toThrow();
    expect(getWizardAbortSignal().aborted).toBe(true);
    vi.advanceTimersByTime(2_000);
    expect(exitSpy).toHaveBeenCalledWith(130);
  });

  it('still exits when saveCheckpoint throws', () => {
    mockSaveCheckpoint.mockImplementation(() => {
      throw new Error('disk full');
    });
    const ctx = makeCtx();

    expect(() => performGracefulExit(ctx)).not.toThrow();
    vi.advanceTimersByTime(2_000);
    expect(exitSpy).toHaveBeenCalledWith(130);
  });
});
