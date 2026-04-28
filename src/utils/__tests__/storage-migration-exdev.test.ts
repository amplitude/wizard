/**
 * Cross-device move regression test.
 *
 * On Linux, `/tmp` is often a tmpfs mount while `$HOME` lives on a
 * regular disk. `renameSync` throws `EXDEV` across mounts. Bugbot caught
 * that the migration shim's `try/catch` swallowed that error, leaving
 * legacy files un-migrated on every Linux upgrade.
 *
 * This test proves the EXDEV fallback (copy + unlink) works by mocking
 * `fs.renameSync` to throw EXDEV the first time it's called. Tests live
 * in their own file because the mock has to be scoped to a single import
 * of the migration module — vi.mock + vi.resetModules between tests in a
 * shared file gets fragile.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fsActual from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock fs BEFORE importing the migration module so renameSync is wrapped.
// The wrapper routes every renameSync call through `renameSpy`. Tests
// override `renameSpy` to throw EXDEV / EPERM. The fallback inside
// `moveFile` performs a second renameSync (to commit the staging copy);
// tests that want that staging rename to succeed call
// `realRenameSync(...)` from inside their mock implementation to bypass
// the wrapper.
//
// `vi.hoisted` keeps both the spy and the real-fn ref accessible to the
// mock factory (which gets hoisted to the top of the file by vi.mock)
// without TDZ issues.
const { renameSpy, realRenameRef } = vi.hoisted(() => ({
  renameSpy: vi.fn(),
  realRenameRef: { current: null as null | typeof fsActual.renameSync },
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  realRenameRef.current = actual.renameSync;
  renameSpy.mockImplementation(actual.renameSync);
  return {
    ...actual,
    renameSync: (...args: unknown[]) =>
      (renameSpy as unknown as (...args: unknown[]) => unknown)(...args),
  };
});

function realRenameSync(src: string, dest: string): void {
  if (!realRenameRef.current) {
    throw new Error('realRenameSync called before fs mock initialized');
  }
  realRenameRef.current(src, dest);
}

import { runMigrationShim } from '../storage-migration.js';
import {
  CACHE_ROOT_OVERRIDE_ENV,
  getStateFile,
  LEGACY_PATHS,
} from '../storage-paths.js';

describe('runMigrationShim — EXDEV cross-device fallback', () => {
  let cacheRoot: string;
  let installDir: string;
  let originalCacheOverride: string | undefined;

  beforeEach(() => {
    cacheRoot = mkdtempSync(join(tmpdir(), 'wiz-migrate-exdev-'));
    installDir = mkdtempSync(join(tmpdir(), 'wiz-migrate-exdev-proj-'));
    originalCacheOverride = process.env[CACHE_ROOT_OVERRIDE_ENV];
    process.env[CACHE_ROOT_OVERRIDE_ENV] = cacheRoot;
    renameSpy.mockReset();
    // Default: the real renameSync. Individual tests override with EXDEV.
    renameSpy.mockImplementation(realRenameSync);
  });

  afterEach(() => {
    rmSync(cacheRoot, { recursive: true, force: true });
    rmSync(installDir, { recursive: true, force: true });
    if (originalCacheOverride === undefined) {
      delete process.env[CACHE_ROOT_OVERRIDE_ENV];
    } else {
      process.env[CACHE_ROOT_OVERRIDE_ENV] = originalCacheOverride;
    }
  });

  it('falls back to copy+unlink when renameSync throws EXDEV', () => {
    // Stage a legacy state file so we have something concrete to migrate.
    const attemptId = 'exdev-test-attempt';
    const legacy = LEGACY_PATHS.state(attemptId);
    writeFileSync(legacy, '{"some":"state"}');

    // Simulate cross-filesystem semantics: only the original
    // `from → to` rename throws EXDEV. The fallback inside `moveFile`
    // copies `from → <to>.tmp` (same FS as <to>) and renames
    // `<to>.tmp → to` (same FS), which on a real cross-FS box would
    // succeed. Honor that here so the test exercises the staging
    // path the way it actually runs in production.
    renameSpy.mockImplementation(((src: unknown, dest: unknown): void => {
      const srcStr = typeof src === 'string' ? src : String(src);
      const destStr = typeof dest === 'string' ? dest : String(dest);
      // The fallback inside `moveFile` stages the copy at `<to>.tmp`
      // and renames it into place. That second rename is same-FS
      // and would succeed on a real cross-device system, so let it
      // through here. Anything else is a fresh `from → to` request
      // that we want to simulate as cross-device.
      if (srcStr.endsWith('.tmp')) {
        return realRenameSync(srcStr, destStr);
      }
      const err = new Error(
        'EXDEV: cross-device link not permitted',
      ) as NodeJS.ErrnoException;
      err.code = 'EXDEV';
      throw err;
    }) as unknown as typeof fsActual.renameSync);

    runMigrationShim(installDir);

    const canonical = getStateFile(attemptId);
    expect(fsActual.existsSync(canonical)).toBe(true);
    expect(fsActual.readFileSync(canonical, 'utf8')).toBe('{"some":"state"}');
    // Legacy is unlinked after copy.
    expect(fsActual.existsSync(legacy)).toBe(false);
    // renameSync was attempted (and threw); the fallback handled it.
    expect(renameSpy).toHaveBeenCalled();
  });

  it('does not swallow non-EXDEV errors from renameSync', () => {
    const attemptId = 'enoperm-test-attempt';
    const legacy = LEGACY_PATHS.state(attemptId);
    writeFileSync(legacy, '{}');

    // EPERM should still cause the move to fail (the shim is best-effort
    // overall but per-file errors still get logged so we know what
    // happened). The shim's outer catch turns this into a silent log.
    renameSpy.mockImplementation(() => {
      const err = new Error(
        'EPERM: operation not permitted',
      ) as NodeJS.ErrnoException;
      err.code = 'EPERM';
      throw err;
    });

    runMigrationShim(installDir);

    // EPERM isn't recoverable → file stays in legacy location.
    expect(fsActual.existsSync(legacy)).toBe(true);
    const canonical = getStateFile(attemptId);
    expect(fsActual.existsSync(canonical)).toBe(false);
  });
});
