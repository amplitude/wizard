/**
 * Unit tests for the per-project apply lockfile.
 *
 * Uses a real tmpdir with `AMPLITUDE_WIZARD_CACHE_DIR` set so the
 * lockfile path resolves under the test's scratch space.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  acquireApplyLock,
  isStale,
  STALE_LOCK_THRESHOLD_MS,
  type ApplyLockHolder,
} from '../apply-lock.js';
import { getApplyLockFile } from '../storage-paths.js';

describe('apply-lock', () => {
  let tmpCache: string;
  let tmpInstall: string;
  const originalCacheEnv = process.env.AMPLITUDE_WIZARD_CACHE_DIR;

  beforeEach(() => {
    tmpCache = fs.mkdtempSync(path.join(os.tmpdir(), 'amp-applylock-cache-'));
    tmpInstall = fs.mkdtempSync(path.join(os.tmpdir(), 'amp-applylock-proj-'));
    process.env.AMPLITUDE_WIZARD_CACHE_DIR = tmpCache;
  });

  afterEach(() => {
    if (originalCacheEnv === undefined) {
      delete process.env.AMPLITUDE_WIZARD_CACHE_DIR;
    } else {
      process.env.AMPLITUDE_WIZARD_CACHE_DIR = originalCacheEnv;
    }
    fs.rmSync(tmpCache, { recursive: true, force: true });
    fs.rmSync(tmpInstall, { recursive: true, force: true });
  });

  it('acquires a fresh lock when no prior lock exists', () => {
    const result = acquireApplyLock(tmpInstall, 'plan-123');
    expect(result.ok).toBe(true);
    expect(fs.existsSync(getApplyLockFile(tmpInstall))).toBe(true);
  });

  it('refuses when a live lock from another pid is present', () => {
    // Write a fake lock for a definitely-live PID — this process itself.
    // The acquire should NOT steal it (we use process.pid as the test
    // sentinel for "live" since the liveness check actually tries
    // `process.kill(pid, 0)`).
    const fakeHolder: ApplyLockHolder = {
      pid: process.pid + 1, // unlikely to exist
      startedAt: new Date().toISOString(),
      planId: 'other-plan',
    };
    // We need a PID that's actually live but not us. Use parent pid (ppid)
    // which is always alive when the test runner is.
    const ppid = process.ppid;
    if (ppid && ppid > 0 && ppid !== process.pid) {
      fakeHolder.pid = ppid;
    }
    const lockFile = getApplyLockFile(tmpInstall);
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    fs.writeFileSync(lockFile, JSON.stringify(fakeHolder));

    const result = acquireApplyLock(tmpInstall, 'plan-123');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('in_progress');
      expect(result.holder.planId).toBe('other-plan');
    }
  });

  it('steals a stale lock when the holder pid no longer exists', () => {
    // Use a sentinel pid we know is dead. PID 99999999 is unlikely to
    // exist on any reasonable system.
    const deadHolder: ApplyLockHolder = {
      pid: 99_999_999,
      startedAt: new Date().toISOString(),
      planId: 'old-plan',
    };
    const lockFile = getApplyLockFile(tmpInstall);
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    fs.writeFileSync(lockFile, JSON.stringify(deadHolder));

    const result = acquireApplyLock(tmpInstall, 'new-plan');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const written = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
      expect(written.pid).toBe(process.pid);
      expect(written.planId).toBe('new-plan');
    }
  });

  it('release() removes the lockfile', () => {
    const result = acquireApplyLock(tmpInstall, 'plan-123');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const lockFile = getApplyLockFile(tmpInstall);
      expect(fs.existsSync(lockFile)).toBe(true);
      result.release();
      expect(fs.existsSync(lockFile)).toBe(false);
    }
  });

  it('release() is a no-op when the lock has already been stolen by another process', () => {
    // Acquire then mutate the file to point at a different pid (simulating
    // a stale-steal by a competitor). release() should NOT remove the
    // file in that case.
    const result = acquireApplyLock(tmpInstall, 'plan-123');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const lockFile = getApplyLockFile(tmpInstall);
      const ppid = process.ppid;
      const competitorPid = ppid && ppid !== process.pid ? ppid : 1;
      fs.writeFileSync(
        lockFile,
        JSON.stringify({
          pid: competitorPid,
          startedAt: new Date().toISOString(),
          planId: 'competitor',
        }),
      );
      result.release();
      // File still there — we didn't own it anymore.
      expect(fs.existsSync(lockFile)).toBe(true);
    }
  });

  describe('isStale', () => {
    it('returns false for a recent lock held by a live pid', () => {
      // Use process.ppid (always alive while this test is running) so we
      // don't false-positive on ESRCH.
      const ppid = process.ppid;
      if (!ppid || ppid === process.pid) {
        // Can't run this assertion meaningfully on this platform.
        return;
      }
      const holder: ApplyLockHolder = {
        pid: ppid,
        startedAt: new Date().toISOString(),
        planId: 'p',
      };
      expect(isStale(holder)).toBe(false);
    });

    it('returns true when the pid is gone (ESRCH)', () => {
      const holder: ApplyLockHolder = {
        pid: 99_999_999,
        startedAt: new Date().toISOString(),
        planId: 'p',
      };
      expect(isStale(holder)).toBe(true);
    });

    it('returns true when older than the stale threshold', () => {
      const longAgo = new Date(Date.now() - STALE_LOCK_THRESHOLD_MS - 1000);
      const holder: ApplyLockHolder = {
        pid: process.pid, // would be live, but age trumps liveness
        startedAt: longAgo.toISOString(),
        planId: 'p',
      };
      expect(isStale(holder)).toBe(true);
    });
  });
});
