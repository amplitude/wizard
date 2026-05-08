import { afterEach, describe, expect, it, vi } from 'vitest';
import { setRerender, triggerRerender } from '../rerender-bridge.js';

describe('rerender-bridge', () => {
  afterEach(() => {
    setRerender(null);
  });

  it('is a no-op when no rerender is registered', () => {
    // Should not throw and should not crash.
    expect(() => triggerRerender()).not.toThrow();
  });

  it('invokes the registered rerender function once per microtask tick', async () => {
    const fn = vi.fn();
    setRerender(fn);
    triggerRerender();
    expect(fn).not.toHaveBeenCalled(); // deferred
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('coalesces multiple triggerRerender calls in the same tick into one rerender', async () => {
    const fn = vi.fn();
    setRerender(fn);
    triggerRerender();
    triggerRerender();
    triggerRerender();
    triggerRerender();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT recurse synchronously when the rerender callback itself calls triggerRerender', async () => {
    // This is the production-breaking scenario: during React's commit
    // phase a store subscriber mutates state → emitChange →
    // triggerRerender. Without the microtask defer, that would recurse
    // synchronously into another instance.rerender() call from inside
    // React's commit, which is exactly what trips "Maximum update depth
    // exceeded".
    //
    // The contract we pin here: a triggerRerender() call from inside the
    // rerender callback must NOT execute the callback again on the same
    // call stack. Subsequent ticks may run additional rerenders (that's
    // fine — and necessary, because state did change), but each one is
    // its own async tick, which React tolerates.
    let depth = 0;
    let maxDepth = 0;
    let totalCalls = 0;
    setRerender(() => {
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
      totalCalls += 1;
      if (totalCalls < 3) {
        // Simulate subscriber re-triggering. Must NOT cause synchronous
        // re-entry — the re-entry guard / microtask defer must hold this
        // back to a later tick.
        triggerRerender();
      }
      depth -= 1;
    });
    triggerRerender();
    // Drain a few microtask ticks.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(maxDepth).toBe(1); // never re-enters synchronously
    // And the chain terminates once the callback stops re-triggering.
    expect(totalCalls).toBe(3);
  });

  it('swallows errors thrown by the rerender callback so the run does not crash', async () => {
    const err = new Error('boom');
    const fn = vi.fn(() => {
      throw err;
    });
    setRerender(fn);
    expect(() => triggerRerender()).not.toThrow();
    await expect(Promise.resolve()).resolves.toBeUndefined();
    expect(fn).toHaveBeenCalled();
  });

  it('clears pending state when rerender is detached', async () => {
    const fn = vi.fn();
    setRerender(fn);
    triggerRerender();
    setRerender(null);
    await Promise.resolve();
    // After detach the scheduled callback finds rerender === null and
    // bails — fn must not have been called.
    expect(fn).not.toHaveBeenCalled();
    // A subsequent re-attach must not be suppressed by stale pending state.
    const fn2 = vi.fn();
    setRerender(fn2);
    triggerRerender();
    await Promise.resolve();
    expect(fn2).toHaveBeenCalledTimes(1);
  });
});
