/**
 * Watcher tests — file-watch wrapper around the orchestration store.
 *
 * fs.watch is platform-flaky (macOS surfaces rename + change; Linux
 * surfaces change only; CI sandboxes throttle events). We test against
 * the public contract: writes to the store fire `onChange` once per
 * debounce window. Polling fallback path is exercised by mounting the
 * watcher BEFORE the store file exists.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getOrchestrationStore, _resetOrchestrationStoreCache } from '../store';
import { watchOrchestrationStore } from '../watcher';
import { getOrchestrationStoreFile } from '../storage-paths';

let installDir: string;
let originalCacheDir: string | undefined;

beforeEach(() => {
  installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-'));
  originalCacheDir = process.env.AMPLITUDE_WIZARD_CACHE_DIR;
  process.env.AMPLITUDE_WIZARD_CACHE_DIR = path.join(installDir, '.cache');
  _resetOrchestrationStoreCache();
});
afterEach(() => {
  if (originalCacheDir === undefined) {
    delete process.env.AMPLITUDE_WIZARD_CACHE_DIR;
  } else {
    process.env.AMPLITUDE_WIZARD_CACHE_DIR = originalCacheDir;
  }
  fs.rmSync(installDir, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('watchOrchestrationStore', () => {
  it('fires onChange when the orchestration store is written', async () => {
    // Seed first so the watcher can attach to an existing file
    // immediately (skips the polling path on platforms where fs.watch
    // requires the file to exist).
    const store = getOrchestrationStore(installDir);
    store.createSession({ goal: 'first' });

    let calls = 0;
    const watcher = watchOrchestrationStore({
      installDir,
      onChange: () => {
        calls += 1;
      },
      debounceMs: 50,
    });

    // Mutate — should fire (debounced) onChange.
    store.createSession({ goal: 'second' });
    // Wait for debounce window plus filesystem latency.
    await sleep(300);
    expect(calls).toBeGreaterThanOrEqual(1);

    watcher.dispose();
  });

  it('debounces a burst of writes into a single onChange', async () => {
    const store = getOrchestrationStore(installDir);
    store.createSession({ goal: 'init' });

    let calls = 0;
    const watcher = watchOrchestrationStore({
      installDir,
      onChange: () => {
        calls += 1;
      },
      debounceMs: 200,
    });

    // 3 rapid writes within the debounce window should coalesce.
    store.createSession({ goal: 'a' });
    store.createSession({ goal: 'b' });
    store.createSession({ goal: 'c' });
    await sleep(500);
    // Could be 1 or 2 depending on platform-specific event flushes; key
    // assertion is "fewer than 3" — i.e. not one per write.
    expect(calls).toBeLessThanOrEqual(2);
    expect(calls).toBeGreaterThanOrEqual(1);

    watcher.dispose();
  });

  it('dispose() is idempotent', () => {
    const watcher = watchOrchestrationStore({
      installDir,
      onChange: () => {
        // noop
      },
    });
    expect(() => {
      watcher.dispose();
      watcher.dispose();
    }).not.toThrow();
  });

  it('does not fire onChange after dispose()', async () => {
    const store = getOrchestrationStore(installDir);
    store.createSession({ goal: 'init' });

    let calls = 0;
    const watcher = watchOrchestrationStore({
      installDir,
      onChange: () => {
        calls += 1;
      },
      debounceMs: 50,
    });

    watcher.dispose();
    store.createSession({ goal: 'after-dispose' });
    await sleep(200);
    expect(calls).toBe(0);
  });

  it('handles being mounted before the store file exists', async () => {
    // Don't seed — watcher mounts on a missing file.
    const path1 = getOrchestrationStoreFile(installDir);
    expect(fs.existsSync(path1)).toBe(false);
    let calls = 0;
    const watcher = watchOrchestrationStore({
      installDir,
      onChange: () => {
        calls += 1;
      },
      debounceMs: 50,
    });
    // Tiny delay to let the polling path detect the file's appearance.
    await sleep(50);
    const store = getOrchestrationStore(installDir);
    store.createSession({ goal: 'late' });
    // Polling fallback runs every 1s; give it room.
    await sleep(1300);
    // The watcher may or may not pick up the create event itself
    // depending on the platform — but a SECOND write definitely fires.
    store.createSession({ goal: 'after-attach' });
    await sleep(400);
    expect(calls).toBeGreaterThanOrEqual(1);
    watcher.dispose();
  }, 10_000);
});
