/**
 * Shared test helper for creating ephemeral temp directories.
 *
 * Centralises the pattern that appeared inlined across ~75 test files:
 *
 *     const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prefix-'));
 *     // ...
 *     fs.rmSync(tmpDir, { recursive: true, force: true });
 *
 * The helper preserves identical semantics (mkdtempSync under `os.tmpdir()`
 * with the caller's prefix, recursive+force cleanup) so migrating call sites
 * is a behaviour-preserving refactor. No vitest hooks are registered for the
 * caller — wire the returned `cleanup` into `afterEach`, a try/finally, or
 * wherever your test currently disposes of the directory.
 *
 * Windows: `os.tmpdir()` already returns a platform-appropriate path
 * (e.g. `C:\\Users\\<user>\\AppData\\Local\\Temp`) and `path.join` uses the
 * platform separator, so no extra handling is required here.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface TempDirHandle {
  /** Absolute path to the freshly created temp directory. */
  readonly dir: string;
  /**
   * Recursively removes the temp directory. Safe to call more than once and
   * safe to call when the directory has already been deleted (`force: true`).
   */
  readonly cleanup: () => void;
}

/**
 * Create a unique temp directory under `os.tmpdir()`.
 *
 * @param prefix - Optional prefix for the directory name. A trailing `-` is
 *   appended if missing so the random suffix is visually separated, matching
 *   the convention used throughout the codebase.
 * @returns A handle with the directory path and a cleanup function.
 */
export function createTempDir(prefix: string = 'wizard-test-'): TempDirHandle {
  const normalisedPrefix = prefix.endsWith('-') ? prefix : `${prefix}-`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), normalisedPrefix));
  const cleanup = (): void => {
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { dir, cleanup };
}
