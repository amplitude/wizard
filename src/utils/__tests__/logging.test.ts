import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  prepareMessage,
  l,
  nl,
  green,
  red,
  dim,
  yellow,
  cyan,
  debug,
} from '../logging.js';

// ── prepareMessage ────────────────────────────────────────────────────────────

describe('prepareMessage', () => {
  it('returns strings unchanged', () => {
    expect(prepareMessage('hello')).toBe('hello');
  });

  it('returns the stack trace for Error instances', () => {
    const err = new Error('boom');
    const result = prepareMessage(err);
    expect(result).toContain('boom');
  });

  it('falls back to empty string when Error has no stack', () => {
    const err = new Error('no stack');
    err.stack = undefined;
    const result = prepareMessage(err);
    expect(result).toBe('');
  });

  it('JSON-stringifies plain objects', () => {
    const result = prepareMessage({ a: 1 });
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });

  it('JSON-stringifies arrays', () => {
    const result = prepareMessage([1, 2, 3]);
    expect(JSON.parse(result)).toEqual([1, 2, 3]);
  });

  it('JSON-stringifies numbers', () => {
    expect(prepareMessage(42)).toBe('42');
  });
});

// ── console-forwarding helpers ────────────────────────────────────────────────

describe('logging helpers', () => {
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  afterEach(() => consoleSpy.mockClear());

  it('l() calls console.log with the message', () => {
    l('test message');
    expect(consoleSpy).toHaveBeenCalledWith('test message');
  });

  it('nl() calls console.log with an empty string', () => {
    nl();
    expect(consoleSpy).toHaveBeenCalledWith('');
  });

  it('green() calls console.log', () => {
    green('text');
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it('red() calls console.log', () => {
    red('text');
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it('dim() calls console.log', () => {
    dim('text');
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it('yellow() calls console.log', () => {
    yellow('text');
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it('cyan() calls console.log', () => {
    cyan('text');
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it('debug() calls console.log', () => {
    debug('text');
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });
});
