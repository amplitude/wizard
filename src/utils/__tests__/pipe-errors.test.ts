import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Writable } from 'node:stream';
import {
  installPipeErrorHandlers,
  safePipeWrite,
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
});
