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
  let disposed = false;

  /**
   * Returns `'newly-attached'` only when this call actually attached a
   * watcher. The caller uses that to decide whether `onChange` should
   * fire — distinguishing a fresh attach from "already attached" or
   * "still unavailable" lets us avoid duplicate UI updates.
   */
  const tryAttach = (target: string): 'newly-attached' | 'already' | 'miss' => {
    if (disposed) return 'miss';
    if (attached.has(target)) return 'already';
    const w = watch(target, opts.onChange);
    if (!w) return 'miss';
    attached.add(target);
    handles.push(w);
    return 'newly-attached';
  };

  const allAttached = (): boolean =>
    attached.has(opts.canonicalPath) && attached.has(opts.legacyPath);

  /**
   * Start polling iff we haven't already AND one or both paths are still
   * missing. Stops polling once both are attached.
   *
   * Critical: polling continues even after one path attaches. The
   * previous implementation stopped polling as soon as ANY path
   * attached, which broke the dashboard flow — bundled context-hub
   * skills only ever write the legacy path, so when canonical existed
   * at startup (e.g. from a prior run) the wizard latched onto it and
   * silently missed the agent's eventual write to the legacy path.
   */
  const startPolling = () => {
    if (pollHandle !== undefined || disposed || allAttached()) return;
    pollHandle = setIntervalFn(() => {
      const a = tryAttach(opts.canonicalPath);
      const b = tryAttach(opts.legacyPath);
      if (a === 'newly-attached' || b === 'newly-attached') {
        opts.onChange();
      }
      if (allAttached()) {
        clearIntervalFn(pollHandle);
        pollHandle = undefined;
      }
    }, pollMs);
  };

  const initialCanonical = tryAttach(opts.canonicalPath);
  const initialLegacy = tryAttach(opts.legacyPath);
  if (
    initialCanonical === 'newly-attached' ||
    initialLegacy === 'newly-attached'
  ) {
    opts.onChange();
  }
  if (!allAttached()) startPolling();

  return {
    watchers: () => handles,
    isWatching: () => handles.length > 0,
    dispose: () => {
      disposed = true;
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
