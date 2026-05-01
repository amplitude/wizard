import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Writable } from 'node:stream';
import {
  installPipeErrorHandlers,
  safePipeWrite,
  __resetPipeAbortTriggeredForTests,
  __setPipeAbortDispatcherForTests,
  __test,
} from '../pipe-errors';

const { isPipeError, PIPE_ERROR_CODES } = __test;

describe('pipe-errors', () => {
  describe('isPipeError', () => {
    it.each([['EPIPE'], ['EIO'], ['ECONNRESET']])(
      'recognizes %s as a pipe error',
      (code) => {
        const err = Object.assign(new Error('mock'), { code });
        expect(isPipeError(err)).toBe(true);
      },
    );

    it.each([
      [{ code: 'ENOENT' }],
      [{ code: 'EACCES' }],
      [new Error('plain error with no code')],
      [{}],
      [null],
      [undefined],
      ['string error'],
      [42],
    ])('rejects non-pipe errors: %j', (err) => {
      expect(isPipeError(err)).toBe(false);
    });

    it('exports the canonical PIPE_ERROR_CODES set so callers can introspect', () => {
      expect(PIPE_ERROR_CODES.has('EPIPE')).toBe(true);
      expect(PIPE_ERROR_CODES.has('EIO')).toBe(true);
      expect(PIPE_ERROR_CODES.has('ECONNRESET')).toBe(true);
      expect(PIPE_ERROR_CODES.size).toBe(3);
    });
  });

  describe('safePipeWrite', () => {
    let stream: Writable & { write: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      // Reset the trigger flag and install a no-op dispatcher so the
      // EPIPE-handling tests below don't accidentally schedule a real
      // wizard abort (which would import wizard-abort.ts and try to
      // exit the test runner). Each test that wants to assert the
      // dispatcher fired re-installs a vi.fn() of its own.
      __resetPipeAbortTriggeredForTests();
      __setPipeAbortDispatcherForTests(() => {
        /* no-op */
      });
      stream = new Writable({
        write: (_chunk, _enc, cb) => cb(),
      }) as Writable & { write: ReturnType<typeof vi.fn> };
      stream.write = vi.fn();
    });

    it('returns true and writes when the stream accepts the chunk', () => {
      stream.write.mockReturnValue(true);
      const result = safePipeWrite(stream, 'hello');
      expect(stream.write).toHaveBeenCalledWith('hello');
      expect(result).toBe(true);
    });

    it('returns false and swallows EPIPE on synchronous throw', () => {
      stream.write.mockImplementation(() => {
        throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
      });
      // Must not throw — the whole point of the helper.
      expect(() => safePipeWrite(stream, 'hello')).not.toThrow();
      expect(safePipeWrite(stream, 'again')).toBe(false);
    });

    it('returns false and swallows EIO / ECONNRESET on synchronous throw', () => {
      for (const code of ['EIO', 'ECONNRESET']) {
        stream.write.mockImplementation(() => {
          throw Object.assign(new Error(`write ${code}`), { code });
        });
        expect(safePipeWrite(stream, 'data')).toBe(false);
      }
    });

    it('re-throws non-pipe errors unchanged', () => {
      const realError = Object.assign(new Error('out of memory'), {
        code: 'ENOMEM',
      });
      stream.write.mockImplementation(() => {
        throw realError;
      });
      expect(() => safePipeWrite(stream, 'hello')).toThrow(realError);
    });

    it('passes through the stream.write return value (backpressure signal)', () => {
      stream.write.mockReturnValue(false); // backpressure
      expect(safePipeWrite(stream, 'big')).toBe(false);
      stream.write.mockReturnValue(true);
      expect(safePipeWrite(stream, 'small')).toBe(true);
    });
  });

  describe('installPipeErrorHandlers', () => {
    it('is idempotent — second call does not stack listeners', () => {
      // Capture the current count, install twice, confirm <=1 added per stream.
      const stdoutBefore = process.stdout.listenerCount('error');
      const stderrBefore = process.stderr.listenerCount('error');
      installPipeErrorHandlers();
      installPipeErrorHandlers();
      installPipeErrorHandlers();
      // At most one listener added per stream across all three calls.
      expect(
        process.stdout.listenerCount('error') - stdoutBefore,
      ).toBeLessThanOrEqual(1);
      expect(
        process.stderr.listenerCount('error') - stderrBefore,
      ).toBeLessThanOrEqual(1);
    });
  });

  // ── EPIPE → wizard-abort trigger ─────────────────────────────────
  //
  // Before this fix, safePipeWrite swallowed EPIPE silently and the
  // wizard would keep running — burning cycles on a doomed pipe with
  // no audience. The new behavior: first detected pipe break
  // schedules a deferred `abortWizard()` so the run exits cleanly.
  //
  // These tests use `setImmediate`-aware mocks to verify the trigger
  // fires exactly once and that the dynamic import happens. The
  // actual `abortWizard` resolution is mocked because importing it
  // for real would call `process.exit`.

  describe('EPIPE triggers a one-shot wizard abort', () => {
    let stream: Writable & { write: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
      // Drain any setImmediate that prior tests scheduled. If a prior
      // EPIPE-test test scheduled an abort with the default dispatcher,
      // its setImmediate is still pending when this test starts and
      // would otherwise fire AFTER we install our test dispatcher,
      // causing a double-call.
      await new Promise((r) => setImmediate(r));
      __resetPipeAbortTriggeredForTests();
      stream = new Writable({
        write: (_chunk, _enc, cb) => cb(),
      }) as Writable & { write: ReturnType<typeof vi.fn> };
      stream.write = vi.fn().mockImplementation(() => {
        throw Object.assign(new Error('EPIPE'), { code: 'EPIPE' });
      });
    });

    it('schedules an abort the first time safePipeWrite hits EPIPE', async () => {
      // Inject a deterministic dispatcher so we don't have to wrestle
      // vi.mock with the dynamic-import shape of the real one.
      const dispatcher = vi.fn();
      __setPipeAbortDispatcherForTests(dispatcher);

      // First write triggers the deferred abort.
      expect(safePipeWrite(stream, 'first')).toBe(false);
      // Second write must still be a no-op AND must not re-trigger.
      expect(safePipeWrite(stream, 'second')).toBe(false);
      expect(safePipeWrite(stream, 'third')).toBe(false);

      // Trigger is deferred via setImmediate — let the next tick run.
      await new Promise((r) => setImmediate(r));

      expect(dispatcher).toHaveBeenCalledTimes(1);

      __setPipeAbortDispatcherForTests(null);
    });

    it('async stream-error listener also triggers exactly one abort', async () => {
      const dispatcher = vi.fn();
      __setPipeAbortDispatcherForTests(dispatcher);

      installPipeErrorHandlers();

      // Dispatch the same EPIPE-shaped error through process.stdout's
      // error event — the async path that fires when Node's
      // afterWriteDispatched detects the broken pipe a tick later.
      const err = Object.assign(new Error('EPIPE'), { code: 'EPIPE' });
      process.stdout.emit('error', err);

      await new Promise((r) => setImmediate(r));

      expect(dispatcher).toHaveBeenCalledTimes(1);
      __setPipeAbortDispatcherForTests(null);
    });

    it('does NOT trigger when the error is non-pipe (re-thrown unchanged)', () => {
      __resetPipeAbortTriggeredForTests();
      const dispatcher = vi.fn();
      __setPipeAbortDispatcherForTests(dispatcher);

      stream.write.mockImplementation(() => {
        throw Object.assign(new Error('out of memory'), { code: 'ENOMEM' });
      });
      expect(() => safePipeWrite(stream, 'data')).toThrow(/out of memory/);
      expect(dispatcher).not.toHaveBeenCalled();

      __setPipeAbortDispatcherForTests(null);
    });

    // Bugbot regression (Medium): without `suppressPipeAbort`, a
    // wizard already in `wizardSuccessExit` that emits `run_completed`
    // and hits a closed pipe would schedule `setImmediate(() =>
    // wizardAbort())`. The deferred abort fires during the success
    // path's analytics-shutdown await and calls `process.exit(130)`
    // before the success path reaches `process.exit(0)`. Result: a
    // fully successful run exits with USER_CANCELLED (130) instead
    // of 0, breaking CI watchers.
    it('suppressPipeAbort short-circuits the deferred trigger entirely', async () => {
      const dispatcher = vi.fn();
      __setPipeAbortDispatcherForTests(dispatcher);

      const { suppressPipeAbort } = await import('../pipe-errors');
      // Mark "already exiting" as wizardSuccessExit / wizardAbort do.
      suppressPipeAbort();

      // Now hit EPIPE. With the suppression flag, no abort scheduled.
      expect(safePipeWrite(stream, 'first')).toBe(false);
      expect(safePipeWrite(stream, 'second')).toBe(false);

      await new Promise((r) => setImmediate(r));
      expect(dispatcher).not.toHaveBeenCalled();

      __setPipeAbortDispatcherForTests(null);
    });
  });
});
