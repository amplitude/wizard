import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { watchFileWhenAvailable } from '../watchFileWhenAvailable.js';

/** Minimal stand-in for fs.FSWatcher used as the resolved value of fs.watch. */
function makeFakeWatcher() {
  const close = vi.fn();
  return { close } as unknown as fs.FSWatcher & {
    close: ReturnType<typeof vi.fn>;
  };
}

describe('watchFileWhenAvailable', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('attaches immediately when the file already exists', () => {
    const watcher = makeFakeWatcher();
    const watch = vi.fn(() => watcher);
    const onChange = vi.fn();

    const handle = watchFileWhenAvailable({
      filePath: '/tmp/exists',
      onChange,
      watch,
    });

    expect(watch).toHaveBeenCalledTimes(1);
    expect(handle.isWatching()).toBe(true);

    handle.dispose();
    expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(handle.isWatching()).toBe(false);
  });

  it('polls when the file is missing, then attaches once it appears', () => {
    let exists = false;
    const watcher = makeFakeWatcher();
    const watch = vi.fn(() => (exists ? watcher : undefined));
    const accessSync = vi.fn(() => {
      if (!exists) throw new Error('ENOENT');
    });
    const onChange = vi.fn();

    const handle = watchFileWhenAvailable({
      filePath: '/tmp/missing',
      onChange,
      watch,
      accessSync,
    });

    // Initial attempt failed — should be polling, not watching yet.
    expect(handle.isWatching()).toBe(false);
    expect(onChange).not.toHaveBeenCalled();

    // File still missing after a tick — still polling, no leak.
    vi.advanceTimersByTime(1000);
    expect(handle.isWatching()).toBe(false);

    // File appears.
    exists = true;
    vi.advanceTimersByTime(1000);
    expect(handle.isWatching()).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);

    handle.dispose();
    expect(watcher.close).toHaveBeenCalledTimes(1);
  });

  it('rapid mount/unmount during polling does not leak a watcher', () => {
    // Simulates the race: the polling interval has just discovered the
    // file (accessSync passes) and is about to call fs.watch. The
    // component unmounts in the same synchronous tick. Without the
    // disposed-check, the new watcher would silently leak because the
    // closed-over watcher variable was never assigned.
    let exists = false;
    const watcher = makeFakeWatcher();
    const watch = vi.fn(() => (exists ? watcher : undefined));
    const accessSync = vi.fn(() => {
      if (!exists) throw new Error('ENOENT');
    });

    const handle = watchFileWhenAvailable({
      filePath: '/tmp/race',
      onChange: () => {
        /* irrelevant */
      },
      watch,
      accessSync,
    });

    // The very tick that finds the file is the same tick we dispose in.
    // Pre-fix this would leak: clearInterval ran before fs.watch
    // returned, dispose closed `undefined`, then the watcher was
    // assigned post-cleanup. With the fix, the disposed-check inside
    // attach() closes the just-created watcher inline.
    exists = true;
    // First simulate dispose right before timer fires by disposing now,
    // then advancing — disposed check should short-circuit attach.
    handle.dispose();
    vi.advanceTimersByTime(1000);

    // The initial attach (file missing) called watch once and got
    // undefined back. After dispose(), the poll timer is cleared so it
    // can never reach the second watch call. No leaked watcher.
    expect(watch).toHaveBeenCalledTimes(1);
    expect(watcher.close).not.toHaveBeenCalled();
    expect(handle.isWatching()).toBe(false);
  });

  it('dispose mid-attach during poll closes the just-created watcher', () => {
    // Scenario: poll tick has called accessSync (file exists). It now
    // calls fs.watch. WHILE fs.watch is mid-execution, the component
    // unmounts (caller invokes dispose). After watch returns, attach()
    // re-checks disposed and closes the just-returned watcher inline
    // rather than leaking it.
    let exists = false;
    const watcher = makeFakeWatcher();
    let handleRef: { dispose: () => void } | null = null;

    const watch = vi.fn(() => {
      if (!exists) return undefined;
      // Simulate concurrent unmount happening inside the watch call.
      handleRef?.dispose();
      return watcher;
    });
    const accessSync = vi.fn(() => {
      if (!exists) throw new Error('ENOENT');
    });

    const handle = watchFileWhenAvailable({
      filePath: '/tmp/mid-attach',
      onChange: () => undefined,
      watch,
      accessSync,
    });
    handleRef = handle;

    // File appears — poll tick will accessSync OK then call watch,
    // which disposes us mid-call.
    exists = true;
    vi.advanceTimersByTime(1000);

    // The just-created watcher must have been closed inline.
    expect(watcher.close).toHaveBeenCalledTimes(1);
    expect(handle.isWatching()).toBe(false);
  });

  it('dispose is idempotent', () => {
    const watcher = makeFakeWatcher();
    const handle = watchFileWhenAvailable({
      filePath: '/tmp/idempotent',
      onChange: () => undefined,
      watch: () => watcher,
    });

    handle.dispose();
    handle.dispose();
    handle.dispose();
    expect(watcher.close).toHaveBeenCalledTimes(1);
  });

  it('does not invoke onChange after dispose', () => {
    let listener: () => void = () => undefined;
    const watcher = makeFakeWatcher();
    const watch = vi.fn((_target: string, l: () => void) => {
      listener = l;
      return watcher;
    });
    const onChange = vi.fn();

    const handle = watchFileWhenAvailable({
      filePath: '/tmp/late-event',
      onChange,
      watch,
    });

    handle.dispose();
    listener(); // event fires after dispose — must be a no-op
    expect(onChange).not.toHaveBeenCalled();
  });
});
