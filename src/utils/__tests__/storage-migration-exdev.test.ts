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
// The wrapper throws EXDEV on the first call only — subsequent operations
// (copyFileSync, unlinkSync, etc.) pass through to the real fs.
const originalRenameSync = fsActual.renameSync;
const renameSpy = vi.fn(originalRenameSync);

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    renameSync: (...args: unknown[]) =>
      (renameSpy as unknown as (...args: unknown[]) => unknown)(...args),
  };
});

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
    renameSpy.mockImplementation(originalRenameSync);
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

    // Mock renameSync to throw EXDEV on every call. The migration's
    // catch block should detect EXDEV specifically and copy+unlink
    // instead of giving up.
    renameSpy.mockImplementation(() => {
      const err = new Error(
        'EXDEV: cross-device link not permitted',
      ) as NodeJS.ErrnoException;
      err.code = 'EXDEV';
      throw err;
    });

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
