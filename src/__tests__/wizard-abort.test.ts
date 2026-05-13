import {
  wizardAbort,
  WizardError,
  registerCleanup,
  registerPriorityCleanup,
  clearCleanup,
  _resetWizardAbortInProgressForTests,
} from '../utils/wizard-abort';
import { analytics } from '../utils/analytics';
import { type Mocked } from 'vitest';
import * as uiModule from '../ui';

vi.mock('../utils/analytics');
vi.mock('../ui', () => ({
  getUI: vi.fn().mockReturnValue({
    outro: vi.fn(),
    cancel: vi.fn(),
    // Optional terminal-event emitter — only AgentUI implements it for
    // real, but the mock needs a no-op stub so wizardAbort can
    // unconditionally call `getUI().emitRunCompleted?.(...)` without
    // tripping on undefined. The tests below assert on .toHaveBeenCalledWith.
    emitRunCompleted: vi.fn(),
    getRunStartedAtMs: vi.fn().mockReturnValue(null),
  }),
}));

const mockAnalytics = analytics as Mocked<typeof analytics>;
const { getUI } = uiModule as unknown as { getUI: ReturnType<typeof vi.fn> };

describe('wizardAbort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCleanup();
    // Production wizardAbort calls process.exit at the end, so the
    // in-progress flag never needs reset. These tests mock process.exit
    // (so wizardAbort returns instead of terminating); without this
    // reset the flag leaks across cases and isWizardAbortInProgress()
    // would falsely report true at the start of the next test.
    _resetWizardAbortInProgressForTests();

    mockAnalytics.captureException = vi.fn();
    mockAnalytics.shutdown = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls getUI().cancel before analytics.shutdown so wizardCapture events from outro hotkeys are flushed', async () => {
    // Bug 1 from PR 331 review: shutdown used to run before cancel,
    // which meant any analytics.wizardCapture call fired during the
    // interactive Outro (press L for log, C for bug report) was queued
    // after the final flush and silently dropped on process.exit.
    // Lock the new order in: cancel first, then shutdown.
    const callOrder: string[] = [];
    mockAnalytics.shutdown.mockImplementation(async () => {
      callOrder.push('shutdown');
    });
    getUI().cancel.mockImplementation(() => {
      callOrder.push('cancel');
    });

    await expect(wizardAbort()).rejects.toThrow('process.exit called');

    expect(callOrder).toEqual(['cancel', 'shutdown']);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('uses default message and exit code when called with no options', async () => {
    await expect(wizardAbort()).rejects.toThrow('process.exit called');

    expect(getUI().cancel).toHaveBeenCalledWith(
      'Wizard setup cancelled.',
      undefined,
    );
    expect(mockAnalytics.shutdown).toHaveBeenCalledWith('cancelled');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('uses custom message and exit code', async () => {
    await expect(
      wizardAbort({ message: 'Custom failure', exitCode: 2 }),
    ).rejects.toThrow('process.exit called');

    expect(getUI().cancel).toHaveBeenCalledWith('Custom failure', undefined);
    expect(process.exit).toHaveBeenCalledWith(2);
  });

  it('forwards cancelOptions.docsUrl into getUI().cancel', async () => {
    // Used by the version-check cancel path in agent-runner: an
    // unsupported version routes through wizardAbort and we want the
    // "Manual setup guide" link to surface in the Outro.
    await expect(
      wizardAbort({
        message: 'Unsupported version',
        cancelOptions: { docsUrl: 'https://example.com/docs' },
      }),
    ).rejects.toThrow('process.exit called');

    expect(getUI().cancel).toHaveBeenCalledWith('Unsupported version', {
      docsUrl: 'https://example.com/docs',
    });
  });

  it('captures error in analytics and shuts down as error when error is provided', async () => {
    const error = new Error('something broke');

    await expect(wizardAbort({ error })).rejects.toThrow('process.exit called');

    expect(mockAnalytics.captureException).toHaveBeenCalledWith(error, {});
    expect(mockAnalytics.shutdown).toHaveBeenCalledWith('error');
  });

  it('does not capture error when no error is provided', async () => {
    await expect(wizardAbort()).rejects.toThrow('process.exit called');

    expect(mockAnalytics.captureException).not.toHaveBeenCalled();
  });

  it('includes WizardError context in analytics capture', async () => {
    const error = new WizardError('MCP missing', {
      integration: 'nextjs',
      'error type': 'MCP_MISSING',
    });

    await expect(wizardAbort({ error })).rejects.toThrow('process.exit called');

    expect(mockAnalytics.captureException).toHaveBeenCalledWith(error, {
      integration: 'nextjs',
      'error type': 'MCP_MISSING',
    });
  });

  it('runs registered cleanup functions before display, with shutdown after cancel', async () => {
    const callOrder: string[] = [];

    registerCleanup(() => callOrder.push('cleanup1'));
    registerCleanup(() => callOrder.push('cleanup2'));
    mockAnalytics.shutdown.mockImplementation(async () => {
      callOrder.push('shutdown');
    });
    getUI().cancel.mockImplementation(() => {
      callOrder.push('cancel');
    });

    await expect(wizardAbort()).rejects.toThrow('process.exit called');

    expect(callOrder).toEqual(['cleanup1', 'cleanup2', 'cancel', 'shutdown']);
  });

  it('runs priority cleanups before regular cleanups (ordering invariant)', async () => {
    const callOrder: string[] = [];

    // Register the LATER cleanup first to prove insertion order doesn't
    // matter — priority cleanups still run before any regular one.
    registerCleanup(() => callOrder.push('regular1'));
    registerCleanup(() => callOrder.push('regular2'));
    registerPriorityCleanup(() => callOrder.push('priority1'));
    registerPriorityCleanup(() => callOrder.push('priority2'));

    await expect(wizardAbort()).rejects.toThrow('process.exit called');

    // priority2 was registered last among priority cleanups, so it
    // unshifts to the front. Both priority cleanups MUST run before any
    // regular cleanup — that's the guarantee callers depend on.
    expect(callOrder).toEqual([
      'priority2',
      'priority1',
      'regular1',
      'regular2',
    ]);
  });

  it('regression: priority cleanup restores file before any regular cleanup writes a stub', async () => {
    // Models the bug: this branch archives the user's prior setup
    // report and registers a restore-on-failure. PR #327 added a
    // fallback-stub writer that registers via `registerCleanup`. If
    // the stub writer ran first (FIFO), it would write a fresh
    // canonical report and the restore would see canonical-exists and
    // bail — permanently burying the user's real report in
    // `.previous.md`.
    //
    // The fix: register the restore via `registerPriorityCleanup` so
    // it ALWAYS runs before any other cleanup that may write to the
    // same canonical path. This test asserts that ordering invariant.
    const canonical: { exists: boolean; content: string | null } = {
      exists: false,
      content: null,
    };
    const archive: { exists: boolean; content: string | null } = {
      exists: true,
      content: 'PRIOR USER REPORT',
    };

    // Simulate the restore: if canonical absent and archive present,
    // move archive → canonical (and clear archive).
    const restoreReportIfMissing = (): void => {
      if (canonical.exists) return;
      if (!archive.exists) return;
      canonical.exists = true;
      canonical.content = archive.content;
      archive.exists = false;
      archive.content = null;
    };

    // Simulate the (hypothetical PR #327) stub writer: writes a stub at
    // canonical only if canonical is currently absent.
    const writeFallbackStub = (): void => {
      if (canonical.exists) return;
      canonical.exists = true;
      canonical.content = 'FALLBACK STUB';
    };

    // Register stub writer FIRST via the FIFO API (worst case for ordering)
    // and the restore SECOND via the priority API. The priority API must
    // win regardless.
    registerCleanup(writeFallbackStub);
    registerPriorityCleanup(restoreReportIfMissing);

    await expect(wizardAbort()).rejects.toThrow('process.exit called');

    // Restore ran first → user's prior report is back at canonical.
    // Stub writer's no-op-on-exists guard then preserved that real
    // content instead of overwriting with a stub.
    expect(canonical.exists).toBe(true);
    expect(canonical.content).toBe('PRIOR USER REPORT');
  });

  it('does not block exit when a cleanup function throws', async () => {
    registerCleanup(() => {
      throw new Error('cleanup failed');
    });
    registerCleanup(() => {
      /* this should still run */
    });

    await expect(wizardAbort()).rejects.toThrow('process.exit called');

    expect(mockAnalytics.shutdown).toHaveBeenCalled();
    expect(getUI().cancel).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('shuts down analytics as "cancelled" when no error is provided', async () => {
    await expect(wizardAbort({ message: 'Bad input' })).rejects.toThrow(
      'process.exit called',
    );

    expect(mockAnalytics.shutdown).toHaveBeenCalledWith('cancelled');
  });

  // ── Hard exit deadline ────────────────────────────────────────────────
  //
  // Regression test for the "Press any key to exit doesn't work" bug.
  //
  // `analytics.shutdown` (Amplitude SDK flush) has no internal timeout —
  // when the network is dead (often the same condition that triggered
  // the abort), it awaits a promise that never resolves. Without a hard
  // deadline in `wizardAbort`, the user pressed a key on the OutroScreen,
  // dismissal fired, but `process.exit` never ran and the wizard sat
  // silent until Ctrl+C. Lock in the deadline so a wedged shutdown can
  // never block exit again.
  describe('exit deadline', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('exits even when analytics.shutdown never resolves', async () => {
      // Simulate the dead-network condition: shutdown returns a promise
      // that hangs forever. Pre-fix, this would block process.exit.
      mockAnalytics.shutdown.mockImplementation(
        () => new Promise<void>(() => {}),
      );

      const aborted = wizardAbort();
      // Catch the synthesized 'process.exit called' rejection so the
      // dangling promise doesn't crash the test.
      const aborted$ = aborted.catch(() => undefined);

      // Drain microtasks + advance past the 3s deadline. process.exit
      // must be called within that window.
      await vi.advanceTimersByTimeAsync(3500);
      await aborted$;

      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('exits promptly (before the deadline) when shutdown resolves quickly', async () => {
      // Sanity: the fast path should NOT wait the full 3s. shutdown
      // resolves immediately, so process.exit should fire on the next
      // microtask without needing the timer to advance.
      mockAnalytics.shutdown.mockResolvedValue(undefined);

      const aborted = wizardAbort();
      const aborted$ = aborted.catch(() => undefined);

      // Drain microtasks only — no timer advance.
      await vi.advanceTimersByTimeAsync(0);
      await aborted$;

      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  // ── isWizardAbortInProgress flag ───────────────────────────────────────
  //
  // Regression test for the "Press any key to exit hangs after x on
  // DataIngestionCheckScreen" bug. Several screens navigate to the cancel
  // outro via `setOutroData` without going through wizardAbort; the
  // OutroScreen dismissal handler reads this flag to decide whether to
  // drive the exit itself. If the flag is wrong (stale-true after an
  // earlier real abort, or never-set during one) the exit decision goes
  // to the wrong branch and either double-exits or hangs.
  describe('isWizardAbortInProgress', () => {
    it('is false before any wizardAbort call', async () => {
      const { isWizardAbortInProgress } = await import('../utils/wizard-abort');
      expect(isWizardAbortInProgress()).toBe(false);
    });

    it('flips true once wizardAbort starts and stays true through process.exit', async () => {
      const { isWizardAbortInProgress } = await import('../utils/wizard-abort');
      expect(isWizardAbortInProgress()).toBe(false);

      // Capture the flag value at the moment getUI().cancel() is called —
      // i.e. while the OutroScreen is mounted and a keypress could fire.
      // This is the load-bearing window: OutroScreen reads the flag to
      // decide whether to drive its own exit.
      let flagDuringCancel: boolean | null = null;
      getUI().cancel.mockImplementation(() => {
        flagDuringCancel = isWizardAbortInProgress();
      });

      await expect(wizardAbort()).rejects.toThrow('process.exit called');

      expect(flagDuringCancel).toBe(true);
    });

    it('second concurrent wizardAbort parks instead of double-emitting run_completed', async () => {
      // Reproduces the race the SIGINT handler exposed: agent-runner's
      // error path is mid-flight inside `wizardAbort` (between the
      // `await getUI().cancel(...)` and the terminal `process.exit`)
      // when a Ctrl-C delivery triggers `installAbortSignalHandler`,
      // which calls `wizardAbortRunner` -> a *second* `wizardAbort`.
      // Without the re-entry guard, both calls would run to completion
      // and emit `run_completed` twice.
      let cancelStarted = false;
      let secondCallStarted = false;
      let cancelResolve: (() => void) | null = null;
      getUI().cancel.mockImplementation(async () => {
        cancelStarted = true;
        // Hold the first abort in the async gap that SIGINT would hit.
        await new Promise<void>((resolve) => {
          cancelResolve = resolve;
        });
      });

      // Start the first abort; it parks inside cancel().
      const firstAbort = wizardAbort({ message: 'first', exitCode: 10 });

      // Wait for the first abort to enter the cancel() gap.
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(cancelStarted).toBe(true);
      expect(getUI().cancel).toHaveBeenCalledTimes(1);

      // SIGINT-equivalent re-entry. With the guard in place, this returns
      // a never-resolving promise instead of executing the abort body.
      const secondAbortPromise = wizardAbort({
        message: 'sigint',
        exitCode: 130,
      })
        .then(() => {
          secondCallStarted = true;
        })
        .catch(() => {
          secondCallStarted = true;
        });

      // Give the second call a microtask tick to either park or run.
      await new Promise<void>((resolve) => setImmediate(resolve));

      // Critical assertion: the second call must NOT have advanced into
      // the abort body. If it had, we'd see a second cancel() invocation.
      expect(getUI().cancel).toHaveBeenCalledTimes(1);
      expect(secondCallStarted).toBe(false);

      // Unblock the first abort so it runs through to process.exit.
      cancelResolve?.();
      await expect(firstAbort).rejects.toThrow('process.exit called');

      // run_completed must have been emitted exactly once.
      const emitCalls = getUI().emitRunCompleted.mock.calls.length;
      expect(emitCalls).toBe(1);

      // The second promise stays parked (never resolves) — this is fine
      // in production because process.exit terminates first. We don't
      // await it here.
      void secondAbortPromise;

      // Crucial cleanup: vi.clearAllMocks() in subsequent beforeEach
      // clears mock.calls but NOT mock implementations. Without this
      // reset, the next test's `wizardAbort` would call our parked
      // `cancel` implementation and hang waiting for `cancelResolve`
      // which is local to this test. Restore the default vi.fn().
      getUI().cancel.mockReset();
    });
  });
});

describe('abort() delegates to wizardAbort()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCleanup();
    // Production wizardAbort calls process.exit at the end, so the
    // in-progress flag never needs reset. These tests mock process.exit
    // (so wizardAbort returns instead of terminating); without this
    // reset the flag leaks across cases and isWizardAbortInProgress()
    // would falsely report true at the start of the next test.
    _resetWizardAbortInProgressForTests();

    mockAnalytics.captureException = vi.fn();
    mockAnalytics.shutdown = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('abort() calls wizardAbort with message and exitCode', async () => {
    const { abort } = await import('../utils/setup-utils.js');

    await expect(abort('Test abort', 3)).rejects.toThrow('process.exit called');

    expect(getUI().cancel).toHaveBeenCalledWith('Test abort', undefined);
    expect(process.exit).toHaveBeenCalledWith(3);
  });

  it('abort() uses defaults when called with no args', async () => {
    const { abort } = await import('../utils/setup-utils.js');

    await expect(abort()).rejects.toThrow('process.exit called');

    expect(getUI().cancel).toHaveBeenCalledWith(
      'Wizard setup cancelled.',
      undefined,
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  // ── Terminal `run_completed` emission ───────────────────────────
  //
  // wizardAbort and wizardSuccessExit are the singular exit funnels.
  // Every non-error exit must emit a structured `run_completed` event
  // before the process actually exits — orchestrators rely on its
  // presence (vs absence) to distinguish a clean run from a crash.

  it('emits run_completed with outcome=cancelled when no error provided', async () => {
    await expect(wizardAbort()).rejects.toThrow('process.exit called');

    expect(getUI().emitRunCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'cancelled',
        exitCode: 1,
        durationMs: 0,
      }),
    );
  });

  it('emits run_completed with outcome=error when an error is provided', async () => {
    const err = new WizardError('something broke');
    await expect(wizardAbort({ error: err, exitCode: 10 })).rejects.toThrow(
      'process.exit called',
    );

    expect(getUI().emitRunCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'error',
        exitCode: 10,
      }),
    );
  });

  it('redacts paths in the reason field of run_completed', async () => {
    // The RunCompletedData docstring promises path/URL redaction so the
    // event never leaks `/Users/<name>/...` or query-string secrets.
    await expect(
      wizardAbort({
        message: 'Failed reading /Users/alice/secret-project/config',
        exitCode: 1,
      }),
    ).rejects.toThrow('process.exit called');

    const calls = (getUI().emitRunCompleted as ReturnType<typeof vi.fn>).mock
      .calls;
    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1][0] as { reason?: string };
    expect(lastCall.reason).not.toContain('/Users/alice');
    expect(lastCall.reason).toContain('[path redacted]');
  });

  it('run_completed fires BEFORE analytics.shutdown so it lands on stdout in time', async () => {
    // Critical ordering: the NDJSON event has to be written before the
    // process exit fires. Putting it after the analytics flush would
    // be safer for analytics but risks the exit interrupting stdout.
    const callOrder: string[] = [];
    mockAnalytics.shutdown.mockImplementation(async () => {
      callOrder.push('shutdown');
    });
    (getUI().emitRunCompleted as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        callOrder.push('emitRunCompleted');
      },
    );

    await expect(wizardAbort()).rejects.toThrow('process.exit called');

    const emitIdx = callOrder.indexOf('emitRunCompleted');
    const shutdownIdx = callOrder.indexOf('shutdown');
    expect(emitIdx).toBeGreaterThan(-1);
    expect(shutdownIdx).toBeGreaterThan(-1);
    expect(emitIdx).toBeLessThan(shutdownIdx);
  });

  it('does not throw if emitRunCompleted itself throws — exit must still happen', async () => {
    (getUI().emitRunCompleted as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        throw new Error('emitter blew up');
      },
    );

    // Exit still happens; the emitter throwing is swallowed.
    await expect(wizardAbort()).rejects.toThrow('process.exit called');
    expect(process.exit).toHaveBeenCalled();
  });
});
