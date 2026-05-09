/**
 * per-run-cache — synchronous + async memoization tests.
 *
 * The brief calls out the `gh pr view` / `gh pr list` repeat-call hot
 * path; we don't actually shell out in this test (no `gh` binary needed
 * in CI). Instead we verify the memoization layer:
 *
 *   - sync `memoize` runs the factory exactly once per key
 *   - async `memoizeAsync` deduplicates in-flight callers
 *   - `invalidate(prefix)` evicts matching entries
 *   - `_resetPerRunCache()` empties the whole cache
 *
 * These guarantees are what the brief's `wizard status` cold-start +
 * MCP-availability + gh-call-dedup items rely on.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  memoize,
  memoizeAsync,
  invalidate,
  _resetPerRunCache,
} from '../per-run-cache';

beforeEach(() => {
  _resetPerRunCache();
});

describe('memoize (sync)', () => {
  it('runs the factory exactly once per key, even across many callers', () => {
    const factory = vi.fn(() => 42);
    const a = memoize('k1', factory);
    const b = memoize('k1', factory);
    const c = memoize('k1', factory);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(c).toBe(42);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('caches falsy values (null, undefined, 0, "")', () => {
    let called = 0;
    const value = memoize('k-null', () => {
      called += 1;
      return null;
    });
    expect(value).toBeNull();
    expect(memoize('k-null', () => 'should-not-run')).toBeNull();
    expect(called).toBe(1);
  });

  it('separate keys have separate cache slots', () => {
    expect(memoize('a', () => 'A')).toBe('A');
    expect(memoize('b', () => 'B')).toBe('B');
  });
});

describe('memoizeAsync', () => {
  it('two concurrent callers wait on the same Promise (factory invoked once)', async () => {
    const factory = vi.fn(
      () =>
        new Promise<string>((resolve) => setTimeout(() => resolve('ok'), 5)),
    );
    const [a, b] = await Promise.all([
      memoizeAsync('async-k1', factory),
      memoizeAsync('async-k1', factory),
    ]);
    expect(a).toBe('ok');
    expect(b).toBe('ok');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('serial callers reuse the cached value', async () => {
    const factory = vi.fn(() => Promise.resolve('hello'));
    expect(await memoizeAsync('async-k2', factory)).toBe('hello');
    expect(await memoizeAsync('async-k2', factory)).toBe('hello');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('does NOT cache rejections — next caller gets a fresh attempt', async () => {
    let calls = 0;
    const factory = () => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('transient'));
      return Promise.resolve('ok');
    };
    await expect(memoizeAsync('async-k3', factory)).rejects.toThrow(
      'transient',
    );
    // Second call works.
    await expect(memoizeAsync('async-k3', factory)).resolves.toBe('ok');
    expect(calls).toBe(2);
  });
});

describe('invalidate', () => {
  it('evicts entries by prefix, leaves others untouched', () => {
    memoize('gh:pr-view:42', () => 'pr42');
    memoize('gh:pr-view:43', () => 'pr43');
    memoize('mcp:availability', () => 'avail');
    invalidate('gh:');
    let calls = 0;
    expect(
      memoize('gh:pr-view:42', () => {
        calls += 1;
        return 'fresh';
      }),
    ).toBe('fresh');
    // Untouched.
    expect(memoize('mcp:availability', () => 'should-not-run')).toBe('avail');
    expect(calls).toBe(1);
  });
});

describe('cross-caller dedup pattern (the gh use-case)', () => {
  it('two consecutive callers asking for the same gh-style result share a single fetch', async () => {
    const fetcher = vi.fn(() => Promise.resolve({ pr: 123, state: 'open' }));
    // Caller A
    const a = await memoizeAsync('gh:pr-view:123', fetcher);
    // Caller B
    const b = await memoizeAsync('gh:pr-view:123', fetcher);
    expect(a).toEqual(b);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
