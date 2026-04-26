/**
 * Dual-path file watcher with poll fallback.
 *
 * Used by the wizard agent runner to surface the canonical
 * `<installDir>/.amplitude/{events,dashboard}.json` files and their
 * legacy `.amplitude-events.json` / `.amplitude-dashboard.json` mirrors
 * (which bundled context-hub integration skills still write). Watching
 * BOTH paths keeps the UI fed regardless of which path the agent ends
 * up touching first.
 *
 * Why this lives in its own module:
 *   - The previous inline implementation in `agent-interface.ts` stored
 *     a single watcher per cleanup variable and used `??` to choose
 *     between two `fs.watch` handles. When both paths existed, only one
 *     handle landed in cleanup state — the other leaked a file
 *     descriptor for the duration of the process. This module exposes a
 *     `dispose()` that closes every handle it ever created.
 *   - Splitting it out makes the cleanup contract testable without
 *     spinning up the full `runAgent` flow.
 */

import * as fs from 'node:fs';

export interface DualPathWatcherOptions {
  /** Canonical path (preferred when both exist). */
  canonicalPath: string;
  /** Legacy path (read as a fallback). */
  legacyPath: string;
  /** Called whenever either watched file changes. Should be idempotent. */
  onChange: () => void;
  /**
   * Override `fs.watch` for tests. Default is the real Node API.
   * Returning `undefined` means the watch attempt failed and the helper
   * should fall back to polling.
   */
  watch?: (target: string, listener: () => void) => fs.FSWatcher | undefined;
  /**
   * Override `setInterval` / `clearInterval` for tests. Required to make
   * the poll fallback exercisable without real timers.
   */
  setInterval?: (handler: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  /** Poll cadence in ms. Defaults to 1 s, the same as the inline impl. */
  pollMs?: number;
}

export interface DualPathWatcherHandle {
  /** Returns the FSWatcher handles currently held. Test-only inspection. */
  watchers: () => readonly fs.FSWatcher[];
  /** True once a watcher is attached (canonical OR legacy). */
  isWatching: () => boolean;
  /** Close every watcher we created and stop polling. Idempotent. */
  dispose: () => void;
}

/**
 * Start watching both `canonicalPath` and `legacyPath` for changes. If
 * neither file exists yet, falls back to polling at `pollMs` cadence
 * until at least one appears, then attaches a watcher and stops polling.
 *
 * Each path is attached at most once — partial success (one path
 * appears before the other) doesn't leak watcher handles when the
 * second path eventually appears, because the helper deduplicates.
 *
 * Calling `dispose()` closes every watcher and clears any pending poll.
 */
export function startDualPathWatcher(
  opts: DualPathWatcherOptions,
): DualPathWatcherHandle {
  const watch = opts.watch ?? defaultWatch;
  const setIntervalFn = opts.setInterval ?? globalThis.setInterval;
  const clearIntervalFn = opts.clearInterval ?? globalThis.clearInterval;
  const pollMs = opts.pollMs ?? 1000;

  const handles: fs.FSWatcher[] = [];
  const attached = new Set<string>();
  let pollHandle: unknown;

  const tryAttach = (target: string): boolean => {
    if (attached.has(target)) return true;
    const w = watch(target, opts.onChange);
    if (!w) return false;
    attached.add(target);
    handles.push(w);
    return true;
  };

  const ok = tryAttach(opts.canonicalPath) || tryAttach(opts.legacyPath);
  // We always try to attach the OTHER path as well — short-circuit
  // attaching only one and leaving the other to the poll fallback would
  // miss subsequent file appearances.
  tryAttach(opts.canonicalPath);
  tryAttach(opts.legacyPath);

  if (ok) {
    opts.onChange();
  }

  // Poll until BOTH paths are attached. This covers two cases:
  //   1. Neither file exists at startup — poll until at least one appears.
  //   2. One file exists but the other doesn't — the agent may write to
  //      the missing path later (e.g. legacy dashboard during a run where
  //      only canonical existed from migration). Without this, that write
  //      would go unnoticed.
  if (attached.size < 2) {
    pollHandle = setIntervalFn(() => {
      const before = attached.size;
      tryAttach(opts.canonicalPath);
      tryAttach(opts.legacyPath);
      if (attached.size > before) {
        opts.onChange();
      }
      if (attached.size >= 2) {
        clearIntervalFn(pollHandle);
        pollHandle = undefined;
      }
    }, pollMs);
  }

  return {
    watchers: () => handles,
    isWatching: () => handles.length > 0,
    dispose: () => {
      for (const h of handles) {
        try {
          h.close();
        } catch {
          // Best-effort — close-after-rename can throw on some platforms.
        }
      }
      handles.length = 0;
      attached.clear();
      if (pollHandle !== undefined) {
        clearIntervalFn(pollHandle);
        pollHandle = undefined;
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
