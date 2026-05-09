/**
 * Per-run memoization for expensive read-only side effects.
 *
 * Lifetime is the lifetime of the current Node process. Used by paths
 * that would otherwise re-execute the same `gh pr view` / `gh pr list`
 * / MCP-availability probe multiple times within a single command or
 * agent run — the answer doesn't change inside a run, the underlying
 * call costs ~150-400ms, and the multiplier across deeply-nested call
 * stacks (e.g. status → resume → next-action derivation) makes the
 * cumulative cost noticeable.
 *
 * The cache is intentionally NOT persistent: a fresh `wizard …` invocation
 * always re-fetches, so a stale answer can never outlive the run that
 * produced it. Mutations (`gh pr edit`, MCP install) call
 * `invalidate(prefix)` to drop stale entries inside the same process.
 *
 * Two flavours:
 *   - `memoize(key, factory)` — sync. Used for cheap-but-repeated
 *     calls (e.g. `existsSync` in a tight loop).
 *   - `memoizeAsync(key, factory)` — async, dedupes in-flight calls
 *     so two parallel callers wait on the same Promise instead of
 *     racing duplicate child processes.
 *
 * The cache also distinguishes "negative results" — `null` / `undefined`
 * are cached. `factory` only re-runs after `invalidate()` is called for
 * the key (or its prefix).
 */

const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * Memoize a synchronous factory by key.
 *
 * `factory` runs at most once per cache lifetime (per process, modulo
 * `invalidate`). Returned values are cached even when falsy.
 */
export function memoize<T>(key: string, factory: () => T): T {
  if (cache.has(key)) {
    return cache.get(key) as T;
  }
  const value = factory();
  cache.set(key, value);
  return value;
}

/**
 * Memoize an async factory by key, deduplicating in-flight calls.
 *
 * Two callers racing the same key wait on the same Promise. If the
 * Promise rejects, the failure is NOT cached — the next caller gets a
 * fresh attempt. (We don't want a transient gh outage to poison the
 * cache for the rest of the run.)
 */
export async function memoizeAsync<T>(
  key: string,
  factory: () => Promise<T>,
): Promise<T> {
  if (cache.has(key)) {
    return cache.get(key) as T;
  }
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = (async () => {
    try {
      const value = await factory();
      cache.set(key, value);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

/**
 * Drop all entries whose key starts with `prefix`. Used on mutation
 * paths (`gh pr edit`, MCP install) so stale list-style answers don't
 * outlive the change.
 */
export function invalidate(prefix: string): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
  for (const key of [...inflight.keys()]) {
    if (key.startsWith(prefix)) inflight.delete(key);
  }
}

/** Test helper — clears every cache entry. */
export function _resetPerRunCache(): void {
  cache.clear();
  inflight.clear();
}

// ── gh helpers ───────────────────────────────────────────────────────
//
// Thin wrappers that build a per-run-cache key from the gh subcommand +
// args. The cache is keyed on the exact argv so two callers asking for
// the same PR get a single execution, while a different PR / args path
// runs as expected.

// Use the cross-platform spawn so a Scoop / Chocolatey `gh.cmd` shim
// resolves on Windows. Node's built-in `spawn` doesn't consult PATHEXT,
// so calling `spawn('gh', …)` against a `.cmd`-shimmed install would
// fail with ENOENT even though `gh` is on PATH. Drop-in replacement
// for `child_process.spawn`.
import { spawn } from '../utils/cross-platform-spawn';

interface GhResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runGh(args: readonly string[]): Promise<GhResult> {
  return new Promise((resolve) => {
    const child = spawn('gh', [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (b: Buffer | string) => {
      stdout += typeof b === 'string' ? b : b.toString('utf8');
    });
    child.stderr?.on('data', (b: Buffer | string) => {
      stderr += typeof b === 'string' ? b : b.toString('utf8');
    });
    child.on('error', (err) => {
      resolve({ exitCode: 127, stdout: '', stderr: err.message });
    });
    child.on('close', (code) => {
      resolve({ exitCode: code ?? 0, stdout, stderr });
    });
  });
}

/**
 * Run `gh <args>` and cache the result for the lifetime of the current
 * process. Caller passes a cache prefix so a list-style call can be
 * invalidated independently from a single-PR fetch.
 */
export function ghCachedRun(
  cachePrefix: string,
  args: readonly string[],
): Promise<GhResult> {
  const key = `${cachePrefix}::${args.join(' ')}`;
  return memoizeAsync(key, () => runGh(args));
}
