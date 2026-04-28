import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as fs from 'node:fs';
import { startDualPathWatcher } from '../dual-path-watcher.js';

/**
 * Build a fake `fs.FSWatcher` whose `.close()` is observable.
 *
 * We only need the surface area `dispose()` actually touches, so the
 * cast is safe — runtime tests never call other `FSWatcher` methods.
 */
function makeFakeWatcher(): fs.FSWatcher & { closed: boolean } {
  const watcher = {
    closed: false,
    close() {
      this.closed = true;
    },
    on() {
      return this;
    },
    once() {
      return this;
    },
    addListener() {
      return this;
    },
    removeListener() {
      return this;
    },
    removeAllListeners() {
      return this;
    },
    setMaxListeners() {
      return this;
    },
    getMaxListeners() {
      return 0;
    },
    listeners() {
      return [];
    },
    rawListeners() {
      return [];
    },
    emit() {
      return false;
    },
    listenerCount() {
      return 0;
    },
    prependListener() {
      return this;
    },
    prependOnceListener() {
      return this;
    },
    eventNames() {
      return [];
    },
    ref() {
      return this;
    },
    unref() {
      return this;
    },
  };
  return watcher as unknown as fs.FSWatcher & { closed: boolean };
}

describe('startDualPathWatcher', () => {
  let onChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onChange = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('attaches a single watcher when only the canonical file exists', () => {
    const canonicalWatcher = makeFakeWatcher();
    const watch = vi.fn((target: string) => {
      if (target === '/p/canonical') return canonicalWatcher;
      return undefined; // legacy doesn't exist
    });

    const handle = startDualPathWatcher({
      canonicalPath: '/p/canonical',
      legacyPath: '/p/legacy',
      onChange,
      watch,
    });

    expect(handle.isWatching()).toBe(true);
    expect(handle.watchers()).toHaveLength(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  // Regression: bugbot caught that the inline implementation only stored
  // ONE watcher when both paths existed. The other handle leaked. This
  // test pins the contract that BOTH watchers are tracked and BOTH are
  // closed on dispose.
  it('attaches BOTH watchers when both files exist', () => {
    const canonicalWatcher = makeFakeWatcher();
    const legacyWatcher = makeFakeWatcher();
    const watch = vi.fn((target: string) => {
      if (target === '/p/canonical') return canonicalWatcher;
      if (target === '/p/legacy') return legacyWatcher;
      return undefined;
    });

    const handle = startDualPathWatcher({
      canonicalPath: '/p/canonical',
      legacyPath: '/p/legacy',
      onChange,
      watch,
    });

    expect(handle.watchers()).toHaveLength(2);
    expect(handle.watchers()).toContain(canonicalWatcher);
    expect(handle.watchers()).toContain(legacyWatcher);

    handle.dispose();
    expect(canonicalWatcher.closed).toBe(true);
    expect(legacyWatcher.closed).toBe(true);
  });

  it('falls back to polling when neither file exists', () => {
    const watch = vi.fn(() => undefined);
    const setIntervalFn = vi.fn(() => 'TIMER' as unknown);
    const clearIntervalFn = vi.fn();

    const handle = startDualPathWatcher({
      canonicalPath: '/p/canonical',
      legacyPath: '/p/legacy',
      onChange,
      watch,
      setInterval: setIntervalFn,
      clearInterval: clearIntervalFn,
    });

    expect(handle.isWatching()).toBe(false);
    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();

    handle.dispose();
    expect(clearIntervalFn).toHaveBeenCalledWith('TIMER');
  });

  // Regression: bugbot caught that the previous implementation stopped
  // polling as soon as ONE path attached. That broke dashboard flow —
  // bundled context-hub skills only write the legacy path, so when
  // canonical existed at startup (from a prior run), the wizard latched
  // onto it and silently missed the agent's later write to legacy.
  // Polling MUST continue until BOTH paths are attached.
  it('keeps polling for the missing path when only one attaches at startup', () => {
    let legacyReady = false;
    const canonicalWatcher = makeFakeWatcher();
    const legacyWatcher = makeFakeWatcher();
    const watch = vi.fn((target: string) => {
      if (target === '/p/canonical') return canonicalWatcher;
      if (target === '/p/legacy' && legacyReady) return legacyWatcher;
      return undefined;
    });
    const tickers: Array<() => void> = [];
    const setIntervalFn = vi.fn((handler: () => void) => {
      tickers.push(handler);
      return 'TIMER';
    });
    const clearIntervalFn = vi.fn();

    const handle = startDualPathWatcher({
      canonicalPath: '/p/canonical',
      legacyPath: '/p/legacy',
      onChange,
      watch,
      setInterval: setIntervalFn,
      clearInterval: clearIntervalFn,
    });

    // Canonical attached at startup; legacy missing → polling started.
    expect(handle.watchers()).toEqual([canonicalWatcher]);
    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    expect(clearIntervalFn).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1); // initial canonical onChange

    // Tick before legacy appears: nothing changes, polling continues.
    tickers[0]();
    expect(handle.watchers()).toEqual([canonicalWatcher]);
    expect(clearIntervalFn).not.toHaveBeenCalled();

    // Legacy now appears; tick attaches it and fires onChange exactly once.
    legacyReady = true;
    tickers[0]();
    expect(handle.watchers()).toEqual([canonicalWatcher, legacyWatcher]);
    expect(onChange).toHaveBeenCalledTimes(2);
    // Both attached → polling stopped.
    expect(clearIntervalFn).toHaveBeenCalledWith('TIMER');

    handle.dispose();
    expect(canonicalWatcher.closed).toBe(true);
    expect(legacyWatcher.closed).toBe(true);
  });

  it('stops polling and does not duplicate-attach once both paths exist', () => {
    let canonicalReady = false;
    let legacyReady = false;
    const canonicalWatcher = makeFakeWatcher();
    const legacyWatcher = makeFakeWatcher();
    const watch = vi.fn((target: string) => {
      if (target === '/p/canonical' && canonicalReady) return canonicalWatcher;
      if (target === '/p/legacy' && legacyReady) return legacyWatcher;
      return undefined;
    });
    const tickers: Array<() => void> = [];
    const setIntervalFn = vi.fn((handler: () => void) => {
      tickers.push(handler);
      return 'TIMER';
    });
    const clearIntervalFn = vi.fn();

    const handle = startDualPathWatcher({
      canonicalPath: '/p/canonical',
      legacyPath: '/p/legacy',
      onChange,
      watch,
      setInterval: setIntervalFn,
      clearInterval: clearIntervalFn,
    });

    // Tick: canonical appears first.
    canonicalReady = true;
    tickers[0]();
    expect(handle.watchers()).toEqual([canonicalWatcher]);
    expect(clearIntervalFn).not.toHaveBeenCalled();

    // Tick: legacy appears too.
    legacyReady = true;
    tickers[0]();
    expect(handle.watchers()).toEqual([canonicalWatcher, legacyWatcher]);
    expect(clearIntervalFn).toHaveBeenCalledWith('TIMER');

    // Stray tick after timer cleared: must not re-attach.
    tickers[0]();
    expect(handle.watchers()).toEqual([canonicalWatcher, legacyWatcher]);

    handle.dispose();
  });

  it('a tick that fires after dispose() does not register a stray watcher', () => {
    const watch = vi.fn(() => makeFakeWatcher());
    const tickers: Array<() => void> = [];
    const setIntervalFn = vi.fn((handler: () => void) => {
      tickers.push(handler);
      return 'TIMER';
    });
    const clearIntervalFn = vi.fn();

    const handle = startDualPathWatcher({
      canonicalPath: '/p/canonical',
      legacyPath: '/p/legacy',
      // Force initial attach to fail by mocking watch to return undefined first.
      watch: vi.fn(() => undefined),
      onChange,
      setInterval: setIntervalFn,
      clearInterval: clearIntervalFn,
    });

    handle.dispose();
    // Even if a deferred timer tick runs, the disposed flag should
    // prevent any watcher from being attached.
    void watch;
    expect(handle.watchers()).toEqual([]);
    tickers[0]?.();
    expect(handle.watchers()).toEqual([]);
  });

  it('dispose() is idempotent and safe to call before any watcher attaches', () => {
    const watch = vi.fn(() => undefined);
    const setIntervalFn = vi.fn(() => 'TIMER' as unknown);
    const clearIntervalFn = vi.fn();
    const handle = startDualPathWatcher({
      canonicalPath: '/p/canonical',
      legacyPath: '/p/legacy',
      onChange,
      watch,
      setInterval: setIntervalFn,
      clearInterval: clearIntervalFn,
    });

    handle.dispose();
    handle.dispose();
    // clearInterval should be called once (during the first dispose);
    // the second dispose finds pollHandle = undefined and bails.
    expect(clearIntervalFn).toHaveBeenCalledTimes(1);
  });

  it('swallows close() errors so cleanup never throws', () => {
    const w = makeFakeWatcher();
    w.close = () => {
      throw new Error('post-rename close failed');
    };
    const watch = vi.fn(() => w);
    const handle = startDualPathWatcher({
      canonicalPath: '/p/canonical',
      legacyPath: '/p/legacy',
      onChange,
      watch,
    });
    expect(() => handle.dispose()).not.toThrow();
  });
});
