/**
 * Safety-net tests — verify the uncaughtException / unhandledRejection
 * handlers route through `wizardAbort`, save a checkpoint when a session
 * is registered, and capture to Sentry + analytics.
 *
 * We avoid `process.exit` actually firing by mocking `wizardAbort` itself
 * — the contract under test is "the abort path is invoked once with the
 * correct error", not the downstream exit semantics (which `wizardAbort`
 * already has its own coverage for).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  _handleFatalForTests,
  _resetSafetyNetForTests,
  installSafetyNet,
} from '../safety-net';
import {
  _resetActiveSessionForTests,
  setActiveSession,
} from '../active-session';

const wizardAbortMock = vi.fn(async (_opts?: unknown) => {
  // Simulate wizardAbort's normal contract — it would `process.exit`,
  // but tests obviously can't. Resolving lets the safety-net function
  // return naturally so we can assert on the mock calls.
  return undefined as never;
});

const captureErrorMock = vi.fn();
const captureExceptionMock = vi.fn();
const saveCheckpointMock = vi.fn();

vi.mock('../wizard-abort.js', () => ({
  wizardAbort: (opts?: unknown) => wizardAbortMock(opts),
}));

vi.mock('../../lib/observability/index.js', () => ({
  captureError: (...args: unknown[]) => captureErrorMock(...args),
}));

vi.mock('../analytics.js', () => ({
  analytics: {
    captureException: (...args: unknown[]) => captureExceptionMock(...args),
  },
}));

vi.mock('../../lib/session-checkpoint.js', () => ({
  saveCheckpoint: (...args: unknown[]) => saveCheckpointMock(...args),
}));

describe('safety-net — uncaughtException / unhandledRejection handlers', () => {
  beforeEach(() => {
    _resetSafetyNetForTests();
    _resetActiveSessionForTests();
    wizardAbortMock.mockClear();
    captureErrorMock.mockClear();
    captureExceptionMock.mockClear();
    saveCheckpointMock.mockClear();
  });

  afterEach(() => {
    _resetSafetyNetForTests();
    _resetActiveSessionForTests();
  });

  it('routes a thrown Error through wizardAbort exactly once', async () => {
    const err = new Error('boom from agent hook');
    await _handleFatalForTests('uncaughtException', err);

    expect(wizardAbortMock).toHaveBeenCalledTimes(1);
    const opts = wizardAbortMock.mock.calls[0][0] as {
      error: Error;
      message: string;
      exitCode: number;
    };
    expect(opts.error).toBe(err);
    // INTERNAL_ERROR exit code so orchestrators can distinguish a wizard
    // defect from an environmental failure.
    expect(opts.exitCode).toBe(20);
    // User-facing message includes the error summary
    expect(opts.message).toContain('boom from agent hook');
    // And the recovery hints
    expect(opts.message).toMatch(/Press L|Press C/);
  });

  it('coerces non-Error rejection reasons into Error', async () => {
    await _handleFatalForTests('unhandledRejection', 'string reason');

    expect(wizardAbortMock).toHaveBeenCalledTimes(1);
    const opts = wizardAbortMock.mock.calls[0][0] as { error: Error };
    expect(opts.error).toBeInstanceOf(Error);
    expect(opts.error.message).toBe('string reason');
  });

  it('captures the error to Sentry + analytics before aborting', async () => {
    const err = new Error('telemetry should see this');
    await _handleFatalForTests('uncaughtException', err);

    expect(captureErrorMock).toHaveBeenCalledTimes(1);
    expect(captureErrorMock.mock.calls[0][0]).toBe(err);
    expect(captureErrorMock.mock.calls[0][1]).toMatchObject({
      source: 'uncaughtException',
      fatal: true,
    });

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock.mock.calls[0][0]).toBe(err);
    expect(captureExceptionMock.mock.calls[0][1]).toMatchObject({
      source: 'uncaughtException',
      fatal: true,
    });
  });

  it('attempts saveCheckpoint when an active session is registered', async () => {
    const fakeSession = { installDir: '/tmp/proj', region: 'us' };
    setActiveSession(fakeSession);

    await _handleFatalForTests('uncaughtException', new Error('save me'));

    expect(saveCheckpointMock).toHaveBeenCalledTimes(1);
    expect(saveCheckpointMock.mock.calls[0][0]).toBe(fakeSession);
  });

  it('skips saveCheckpoint cleanly when no session is registered', async () => {
    await _handleFatalForTests('uncaughtException', new Error('pre-tui'));

    // No session registered → no save attempted, but abort still runs.
    expect(saveCheckpointMock).not.toHaveBeenCalled();
    expect(wizardAbortMock).toHaveBeenCalledTimes(1);
  });

  it('telemetry failure does not block the abort path', async () => {
    captureErrorMock.mockImplementationOnce(() => {
      throw new Error('sentry is wedged');
    });
    captureExceptionMock.mockImplementationOnce(() => {
      throw new Error('analytics is wedged');
    });

    await _handleFatalForTests(
      'unhandledRejection',
      new Error('original error'),
    );

    // Even with telemetry blowing up, we still must land at wizardAbort.
    expect(wizardAbortMock).toHaveBeenCalledTimes(1);
  });

  it('saveCheckpoint failure does not block the abort path', async () => {
    setActiveSession({ installDir: '/tmp/x' });
    saveCheckpointMock.mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    await _handleFatalForTests('uncaughtException', new Error('hi'));

    expect(wizardAbortMock).toHaveBeenCalledTimes(1);
  });

  it('installSafetyNet is idempotent — second call does not double-register', () => {
    const before = process.listenerCount('uncaughtException');
    installSafetyNet();
    const after1 = process.listenerCount('uncaughtException');
    installSafetyNet();
    const after2 = process.listenerCount('uncaughtException');

    expect(after1).toBe(before + 1);
    expect(after2).toBe(after1);

    // Cleanup: remove the listeners we added so we don't pollute other tests.
    const listeners = process.listeners('uncaughtException');
    process.removeListener(
      'uncaughtException',
      listeners[listeners.length - 1],
    );
    const rejListeners = process.listeners('unhandledRejection');
    process.removeListener(
      'unhandledRejection',
      rejListeners[rejListeners.length - 1],
    );
  });
});
