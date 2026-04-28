/**
 * watchFileWhenAvailable — single-owner watcher that survives
 * mount/unmount races.
 *
 * Several screens (LogViewer, ReportViewer) share the same file-watch
 * pattern: try `fs.watch(path)` immediately; if the file doesn't exist
 * yet, fall back to polling `fs.accessSync` until it appears, then swap
 * the polling interval out for a real `fs.watch` handle. The naive
 * version of that pattern stored the watcher and the interval in two
 * separate closure variables, so unmount cleanup could fire BETWEEN
 * `clearInterval` and the new `eventPlanWatcher = fs.watch(...)`
 * assignment — leaking the watcher (the closed-over reference is still
 * `undefined` when cleanup runs) and double-firing `onAvailable`.
 *
 * This helper takes ownership of both handles inside a single closure
 * and exposes one `dispose()`. Cleanup reads-and-clears each handle
 * atomically inside the synchronous dispose call, so a mid-poll race
 * either:
 *   - hasn't attached the watcher yet (interval is cleared, never
 *     attaches), or
 *   - has already attached the watcher (close fires), or
 *   - is mid-attach but the `disposed` flag short-circuits before
 *     storing the handle (the local watcher returned from `fs.watch` is
 *     closed inline).
 *
 * Always returns a `dispose` function. Call it from the cleanup return
 * of the owning `useEffect`.
 */

import * as fs from 'node:fs';

export interface WatchFileWhenAvailableOptions {
  /** Path to watch. May not exist yet. */
  filePath: string;
  /**
   * Called once the watcher is attached AND on each subsequent change
   * event. Also called immediately when polling discovers the file for
   * the first time so the caller can read initial contents.
   */
  onChange: () => void;
  /** Poll cadence in ms while the file is missing. Defaults to 1000. */
  pollMs?: number;
  /**
   * Test injection points. Defaults are the real Node APIs.
   * Returning `undefined` from `watch` means "watch attempt failed —
   * fall back to polling".
   */
  watch?: (target: string, listener: () => void) => fs.FSWatcher | undefined;
  accessSync?: (target: string) => void;
  setIntervalFn?: (handler: () => void, ms: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
}

export interface WatchFileWhenAvailableHandle {
  /** Test-only inspection — true while a real watcher is attached. */
  isWatching: () => boolean;
  /** Idempotent. Closes watcher, clears poll, and prevents future attaches. */
  dispose: () => void;
}

export function watchFileWhenAvailable(
  opts: WatchFileWhenAvailableOptions,
): WatchFileWhenAvailableHandle {
  const watch = opts.watch ?? defaultWatch;
  const accessSync = opts.accessSync ?? fs.accessSync;
  const setIntervalFn = opts.setIntervalFn ?? globalThis.setInterval;
  const clearIntervalFn = opts.clearIntervalFn ?? globalThis.clearInterval;
  const pollMs = opts.pollMs ?? 1000;

  let watcher: fs.FSWatcher | undefined;
  let pollHandle: unknown;
  let disposed = false;

  /** Attach the real watcher. Idempotent + race-safe. */
  const attach = (): boolean => {
    if (disposed || watcher) return Boolean(watcher);
    const w = watch(opts.filePath, () => {
      if (!disposed) opts.onChange();
    });
    if (!w) return false;
    if (disposed) {
      // Lost the race — caller disposed while we were inside `fs.watch`.
      // Close the just-created handle inline so it doesn't leak.
      try {
        w.close();
      } catch {
        // best-effort
      }
      return false;
    }
    watcher = w;
    return true;
  };

  // Try immediate attach first. If the file already exists this is the
  // happy path — no polling, no race window.
  if (!attach()) {
    pollHandle = setIntervalFn(() => {
      if (disposed) return;
      try {
        accessSync(opts.filePath);
      } catch {
        return; // still missing
      }
      // File exists. Clear the poll BEFORE attaching so we never have
      // both a live interval AND a live watcher.
      const handle = pollHandle;
      pollHandle = undefined;
      if (handle !== undefined) clearIntervalFn(handle);
      if (attach()) opts.onChange();
    }, pollMs);
  }

  return {
    isWatching: () => watcher !== undefined,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      // Read-and-clear atomically for both handles. The order matters:
      // clear the interval first so a mid-flight poll tick that already
      // ran the `disposed` check above won't reach the attach path.
      const ph = pollHandle;
      pollHandle = undefined;
      if (ph !== undefined) clearIntervalFn(ph);
      const w = watcher;
      watcher = undefined;
      if (w) {
        try {
          w.close();
        } catch {
          // best-effort — close-after-rename can throw on some platforms
        }
      }
    },
  };
}

function defaultWatch(
  target: string,
  listener: () => void,
): fs.FSWatcher | undefined {
  try {
    return fs.watch(target, listener);
  } catch {
    return undefined;
  }
}
