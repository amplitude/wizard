import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  buildRegistryUrl,
  scheduleUpdateCheck,
  _drainPendingNoticeForTest,
} from '../update-notifier.js';
import { CACHE_ROOT_OVERRIDE_ENV } from '../storage-paths.js';

let CACHE_ROOT: string;
let originalCacheOverride: string | undefined;

describe('buildRegistryUrl', () => {
  // Regression test for the Bugbot fix on PR #230. The previous
  // implementation used `encodeURIComponent(pkgName)` which produced
  // `%40amplitude%2Fwizard` — an over-encoded path that the npm
  // registry 404s. Scoped packages must keep the literal `@` and only
  // escape the `/`.
  it('keeps the literal @ and escapes only / for scoped packages', () => {
    expect(buildRegistryUrl('@amplitude/wizard')).toBe(
      'https://registry.npmjs.org/@amplitude%2fwizard',
    );
  });

  it('returns the unchanged name for unscoped packages', () => {
    expect(buildRegistryUrl('lodash')).toBe(
      'https://registry.npmjs.org/lodash',
    );
  });

  it('never encodes the @ sentinel', () => {
    const url = buildRegistryUrl('@amplitude/wizard');
    expect(url).not.toContain('%40');
  });
});

// Regression test for the TUI-rendering bug: writing the notice
// directly to stderr during a TUI session fights Ink's full-screen
// renderer. The fix defers the write until `process.exit`.
describe('scheduleUpdateCheck — deferred stderr write', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _drainPendingNoticeForTest(); // reset module state
    // Redirect the cache root so the disk cache lands somewhere we can clean
    // up — and so we don't depend on `~/.amplitude/wizard/` being writable.
    CACHE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wiz-update-cache-'));
    originalCacheOverride = process.env[CACHE_ROOT_OVERRIDE_ENV];
    process.env[CACHE_ROOT_OVERRIDE_ENV] = CACHE_ROOT;
    process.env.AMPLITUDE_WIZARD_NO_UPDATE_CHECK = ''; // allow the check
    process.env.CI = '';
    process.env.DO_NOT_TRACK = '';
    process.env.NO_UPDATE_NOTIFIER = '';
    process.env.AMPLITUDE_WIZARD_AGENT = '';
    // Force stderr.isTTY so shouldCheckForUpdates() returns true
    Object.defineProperty(process.stderr, 'isTTY', {
      value: true,
      configurable: true,
    });

    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ 'dist-tags': { latest: '99.0.0' } }),
    } as Response);
    stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    stderrSpy.mockRestore();
    _drainPendingNoticeForTest();
    fs.rmSync(CACHE_ROOT, { recursive: true, force: true });
    if (originalCacheOverride === undefined) {
      delete process.env[CACHE_ROOT_OVERRIDE_ENV];
    } else {
      process.env[CACHE_ROOT_OVERRIDE_ENV] = originalCacheOverride;
    }
  });

  it('does NOT write to stderr during runtime', async () => {
    await scheduleUpdateCheck('@amplitude/wizard', '1.0.0');
    // Buffered but not emitted yet
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('buffers the notice for later exit-time flush', async () => {
    await scheduleUpdateCheck('@amplitude/wizard', '1.0.0');
    const buffered = _drainPendingNoticeForTest();
    expect(buffered).toMatch(/new version of @amplitude\/wizard is available/);
    expect(buffered).toMatch(/1\.0\.0 → 99\.0\.0/);
  });

  it('does not buffer when current version is already latest', async () => {
    await scheduleUpdateCheck('@amplitude/wizard', '99.0.0');
    expect(_drainPendingNoticeForTest()).toBeNull();
  });
});
