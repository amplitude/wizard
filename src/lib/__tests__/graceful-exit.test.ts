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

  it('force-quits on second call instead of repeating cleanup', () => {
    const ctx = makeCtx();
    performGracefulExit(ctx);
    expect(_isGracefulExitInProgressForTests()).toBe(true);

    // Second call simulates the user pressing Ctrl+C again to force quit.
    performGracefulExit(ctx);

    // Should not re-run any of the cleanup steps.
    expect(mockSaveCheckpoint).toHaveBeenCalledTimes(1);
    expect(mockFlush).toHaveBeenCalledTimes(1);
    expect(ctx.setCommandFeedback).toHaveBeenCalledTimes(1);

    // The second call should have force-exited immediately with 130.
    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(130);
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
