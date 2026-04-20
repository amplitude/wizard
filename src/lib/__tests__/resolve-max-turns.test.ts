import { describe, it, expect } from 'vitest';
import { resolveMaxTurns } from '../agent-interface';

describe('resolveMaxTurns', () => {
  it('returns the default when the env var is unset', () => {
    expect(resolveMaxTurns(undefined)).toBe(200);
  });

  it('returns the default on empty string', () => {
    expect(resolveMaxTurns('')).toBe(200);
  });

  it('parses a positive integer', () => {
    expect(resolveMaxTurns('30')).toBe(30);
    expect(resolveMaxTurns('1')).toBe(1);
    expect(resolveMaxTurns('500')).toBe(500);
  });

  it('falls back on zero / negative values', () => {
    expect(resolveMaxTurns('0')).toBe(200);
    expect(resolveMaxTurns('-5')).toBe(200);
  });

  it('falls back on non-numeric input', () => {
    expect(resolveMaxTurns('lots')).toBe(200);
    expect(resolveMaxTurns('NaN')).toBe(200);
  });

  it('accepts trailing whitespace via parseInt', () => {
    // parseInt is lenient — 30xyz → 30 — preserved behavior so env vars
    // with accidental whitespace or comments still work.
    expect(resolveMaxTurns('30 # eval mode')).toBe(30);
  });
});
