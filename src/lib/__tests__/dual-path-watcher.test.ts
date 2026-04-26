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

    expect(handle.isWatching()).toBe(true);
    expect(handle.watchers()).toHaveLength(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    // Polling started to watch for the missing legacy path.
    expect(setIntervalFn).toHaveBeenCalledTimes(1);

    handle.dispose();
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

  it('the poll fallback attaches each path at most once even if both eventually appear', () => {
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

    // Tick: canonical appears first, legacy still missing — polling continues.
    canonicalReady = true;
    tickers[0]();
    expect(handle.watchers()).toEqual([canonicalWatcher]);
    expect(clearIntervalFn).not.toHaveBeenCalled();

    // Tick: legacy now also appears — polling stops.
    legacyReady = true;
    tickers[0]();
    expect(handle.watchers()).toEqual([canonicalWatcher, legacyWatcher]);
    expect(clearIntervalFn).toHaveBeenCalled();

    // Even if a stray tick runs (e.g. timer cleared but enqueued), it
    // must not double-attach either path.
    tickers[0]();
    expect(handle.watchers()).toEqual([canonicalWatcher, legacyWatcher]);

    handle.dispose();
    expect(canonicalWatcher.closed).toBe(true);
    expect(legacyWatcher.closed).toBe(true);
  });

  it('polls for the missing legacy path when only canonical exists at startup', () => {
    const canonicalWatcher = makeFakeWatcher();
    const legacyWatcher = makeFakeWatcher();
    let legacyReady = false;
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

    // Canonical attached at startup, onChange fired, but polling starts
    // because legacy is still missing.
    expect(handle.watchers()).toEqual([canonicalWatcher]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(setIntervalFn).toHaveBeenCalledTimes(1);

    // Legacy file appears (agent writes to it).
    legacyReady = true;
    tickers[0]();
    expect(handle.watchers()).toEqual([canonicalWatcher, legacyWatcher]);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(clearIntervalFn).toHaveBeenCalled();

    handle.dispose();
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
