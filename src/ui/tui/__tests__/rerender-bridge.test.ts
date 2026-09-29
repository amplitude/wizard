import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setRerender, triggerRerender } from '../rerender-bridge.js';

describe('rerender-bridge', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    setRerender(null);
    vi.useRealTimers();
  });

  it('yields to timers between renders even when every render requests another', async () => {
    let renders = 0;
    const timer = vi.fn();
    setRerender(() => {
      renders++;
      if (renders < 100) triggerRerender();
    });
    triggerRerender();
    setTimeout(timer, 20);
    await vi.advanceTimersByTimeAsync(20);
    expect(timer).toHaveBeenCalledOnce();
    expect(renders).toBe(1);
    await vi.advanceTimersByTimeAsync(12);
    expect(renders).toBe(2);
  });

  it('is a no-op when no rerender is registered', () => {
    // Should not throw and should not crash.
    expect(() => triggerRerender()).not.toThrow();
  });

  it('invokes the registered rerender function once per scheduled frame', async () => {
    const fn = vi.fn();
    setRerender(fn);
    triggerRerender();
    expect(fn).not.toHaveBeenCalled(); // deferred
    await vi.advanceTimersByTimeAsync(16);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('coalesces multiple triggerRerender calls in the same tick into one rerender', async () => {
    const fn = vi.fn();
    setRerender(fn);
    triggerRerender();
    triggerRerender();
    triggerRerender();
    triggerRerender();
    await vi.advanceTimersByTimeAsync(16);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT recurse synchronously when the rerender callback itself calls triggerRerender', async () => {
    // This is the production-breaking scenario: during React's commit
    // phase a store subscriber mutates state → emitChange →
    // triggerRerender. Without the deferred frame, that would recurse
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
        // re-entry — the re-entry guard / deferred frame must hold this
        // back to a later tick.
        triggerRerender();
      }
      depth -= 1;
    });
    triggerRerender();
    // Advance a few frames.
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(16);
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
    await vi.advanceTimersByTimeAsync(16);
    expect(fn).toHaveBeenCalled();
  });

  it('clears pending state when rerender is detached', async () => {
    const fn = vi.fn();
    setRerender(fn);
    triggerRerender();
    setRerender(null);
    await vi.advanceTimersByTimeAsync(16);
    // After detach the scheduled callback is cancelled — fn must not have been called.
    expect(fn).not.toHaveBeenCalled();
    // A subsequent re-attach must not be suppressed by stale pending state.
    const fn2 = vi.fn();
    setRerender(fn2);
    triggerRerender();
    await vi.advanceTimersByTimeAsync(16);
    expect(fn2).toHaveBeenCalledTimes(1);
  });
});
