import { describe, it, expect } from 'vitest';
import { resolveMaxTurns } from '../agent-interface';

// Upper sanity bound mirrored from agent-interface.ts. Anything north of this
// is far more likely a fat-fingered env var than a legitimate cap, so we
// fall back rather than letting the agent loop nearly-unboundedly.
const SANITY_BOUND = 10000;

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

  it('accepts the sanity-bound value exactly', () => {
    expect(resolveMaxTurns(String(SANITY_BOUND))).toBe(SANITY_BOUND);
  });

  it('falls back on zero / negative values', () => {
    expect(resolveMaxTurns('0')).toBe(200);
    expect(resolveMaxTurns('-5')).toBe(200);
  });

  it('falls back on non-numeric input', () => {
    expect(resolveMaxTurns('lots')).toBe(200);
    expect(resolveMaxTurns('NaN')).toBe(200);
    expect(resolveMaxTurns('abc')).toBe(200);
  });

  it('falls back on absurdly large values past the sanity bound', () => {
    expect(resolveMaxTurns(String(SANITY_BOUND + 1))).toBe(200);
    expect(resolveMaxTurns('999999999')).toBe(200);
  });

  it('accepts trailing junk via parseInt', () => {
    // parseInt is lenient — "30 # eval mode" → 30 — preserved behavior so env
    // vars with accidental whitespace or comments still work.
    expect(resolveMaxTurns('30 # eval mode')).toBe(30);
  });
});
