/**
 * watcher.ts — file-watch wrapper for the orchestration store.
 *
 * Part of v2 PR 4. The `/status` overlay (PR 3) renders a snapshot of
 * the orchestration store. PR 3 left the overlay as a one-shot read at
 * mount time; PR 4 wires a debounced file-watch so the overlay
 * automatically re-renders when the store changes — for example, when
 * an outer agent runs `wizard choice answer` from a sibling shell.
 *
 * **Why fs.watch + debounce?**
 *
 *   - The orchestration store is written via `atomicWriteJSON` (temp
 *     file + rename). Some platforms surface the rename as 1-3 events;
 *     a 200ms debounce coalesces them into one re-render.
 *   - We avoid `chokidar` here on purpose: this module would be the
 *     only chokidar consumer in the wizard, and `fs.watch` is plenty
 *     for a single file. The existing `watchFileWhenAvailable` util
 *     handles the "file might not exist yet" race; we reuse it.
 *
 * **Lifecycle**
 *
 *   - `watchOrchestrationStore({ installDir, onChange, debounceMs? })`
 *     returns an `OrchestrationWatcher` with a `dispose()` method.
 *     Disposal MUST be idempotent — React effects often clean up twice
 *     under StrictMode.
 *   - The watcher tolerates the file not yet existing when watching
 *     starts; it polls until the file appears, then attaches a real
 *     fs.watch handle (delegated to `watchFileWhenAvailable`).
 *
 * Tests live in `src/lib/orchestration/__tests__/watcher.test.ts`.
 */
import * as fs from 'node:fs';
import { existsSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { getOrchestrationStoreFile } from './storage-paths';

export interface WatchOrchestrationStoreOptions {
  installDir: string;
  /** Called (debounced) when the store file changes on disk. */
  onChange: () => void;
  /** Defaults to 200ms — enough to coalesce atomic-rename burst events. */
  debounceMs?: number;
}

export interface OrchestrationWatcher {
  /** Stop watching and release the fs handle. Idempotent. */
  dispose(): void;
}

/**
 * Watch the per-install-dir orchestration store. The watcher emits a
 * single `onChange` per debounce window even when the OS surfaces
 * multiple raw events for one logical write.
 */
export function watchOrchestrationStore(
  opts: WatchOrchestrationStoreOptions,
): OrchestrationWatcher {
  const { installDir, onChange } = opts;
  const debounceMs = opts.debounceMs ?? 200;
  const path = getOrchestrationStoreFile(installDir);

  let disposed = false;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  const fire = () => {
    if (disposed) return;
    if (pendingTimer !== null) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      if (disposed) return;
      try {
        onChange();
      } catch {
        // Listener errors must not poison the watcher.
      }
    }, debounceMs);
  };

  // Watch the parent directory rather than the file itself. The store
  // is written via `atomicWriteJSON` (temp-file + rename), which on
  // most platforms invalidates an `fs.watch` handle that targeted the
  // pre-rename file. Watching the directory and filtering on filename
  // is the supported pattern for "atomic write" producers and works
  // across macOS / Linux / Windows.
  //
  // We keep a polling fallback for the case where the parent directory
  // doesn't exist at mount time (very fresh project, no run dir yet).
  const dir = dirname(path);
  const filename = basename(path);
  let watcher: fs.FSWatcher | undefined;
  let pollHandle: ReturnType<typeof setInterval> | null = null;

  const tryAttach = (): boolean => {
    if (disposed || watcher) return Boolean(watcher);
    if (!existsSync(dir)) return false;
    let w: fs.FSWatcher | undefined;
    try {
      w = fs.watch(dir, (_event, name) => {
        // `name` is the file affected — filter to ours. Some platforms
        // pass `null` for `name`; in that case fire on any event in
        // the dir, since we own it under runs/<hash>/ and there are
        // few neighbours.
        if (name && name !== filename) return;
        fire();
      });
    } catch {
      return false;
    }
    if (!w) return false;
    if (disposed) {
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

  if (!tryAttach()) {
    pollHandle = setInterval(() => {
      if (disposed) return;
      if (!existsSync(dir)) return;
      const ph = pollHandle;
      pollHandle = null;
      if (ph !== null) clearInterval(ph);
      tryAttach();
    }, 1_000);
    if (pollHandle !== null && typeof pollHandle.unref === 'function') {
      // Don't keep the event loop alive solely for the poll.
      pollHandle.unref();
    }
  }

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (pendingTimer !== null) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      if (pollHandle !== null) {
        clearInterval(pollHandle);
        pollHandle = null;
      }
      if (watcher) {
        try {
          watcher.close();
        } catch {
          // best-effort
        }
        watcher = undefined;
      }
    },
  };
}
