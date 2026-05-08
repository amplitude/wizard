/**
 * Unit tests for the per-project apply lockfile.
 *
 * Uses a real tmpdir with `AMPLITUDE_WIZARD_CACHE_DIR` set so the
 * lockfile path resolves under the test's scratch space.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

  // ── Regression: TOCTOU race ────────────────────────────────────────────
  //
  // Pre-fix, `acquireApplyLock` was a read-then-write (with a stale-check
  // delete in between). Two processes could both observe "no live lock"
  // and both `atomicWriteJSON` — last-writer-wins, both believed they
  // owned it. The post-fix path uses `O_CREAT|O_EXCL` (`'wx'`) so the OS
  // serializes acquirers and the loser gets EEXIST. These tests pin the
  // new contract.
  it('regression: only one acquire wins when a lockfile already exists', () => {
    // Simulate "another process already wrote a fresh lock" by planting
    // one with a live pid (process.ppid, which is guaranteed alive while
    // the test runs). Our acquire MUST refuse, not overwrite.
    const lockFile = getApplyLockFile(tmpInstall);
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
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

    const result = acquireApplyLock(tmpInstall, 'plan-123');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.holder.pid).toBe(competitorPid);
      expect(result.reason).toBe('in_progress');
    }
    // File untouched — we didn't clobber the live holder.
    const after = JSON.parse(fs.readFileSync(lockFile, 'utf-8')) as {
      pid: number;
    };
    expect(after.pid).toBe(competitorPid);
  });

  it('regression: stale-steal races resolve to a single winner', () => {
    // Plant a stale lockfile (pid that definitely doesn't exist), then
    // acquire. The acquire should steal cleanly. Then plant the SAME
    // stale lockfile again and call `acquireApplyLock` while we still
    // hold the lock from the first acquire. The second call must NOT
    // succeed — our live pid is in the file now, even though the old
    // stale pid was stomped over it on disk.
    const stale: ApplyLockHolder = {
      pid: 999999, // non-existent pid (Linux/macOS pid space)
      startedAt: new Date(0).toISOString(), // old enough to be stale by age too
      planId: 'old',
    };
    const lockFile = getApplyLockFile(tmpInstall);
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    fs.writeFileSync(lockFile, JSON.stringify(stale));

    const first = acquireApplyLock(tmpInstall, 'plan-A');
    expect(first.ok).toBe(true);
    // After steal, the file should hold OUR pid.
    const afterFirst = JSON.parse(fs.readFileSync(lockFile, 'utf-8')) as {
      pid: number;
    };
    expect(afterFirst.pid).toBe(process.pid);

    // Now a "second acquirer" (still us, simulating a re-entry) tries to
    // grab. It must refuse — our own pid is alive (it's literally us),
    // so the lock is not stale.
    const second = acquireApplyLock(tmpInstall, 'plan-B');
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.holder.pid).toBe(process.pid);
    }
  });

  it('recovers when the lockfile is corrupt (truncated / non-JSON)', () => {
    // The pre-fix path returned `{ ok: false }` here (readLockHolder
    // returned null and the code fell through to "in_progress" using a
    // stale `existing`). The post-fix path treats unparseable content as
    // stale on first attempt and retries the open.
    const lockFile = getApplyLockFile(tmpInstall);
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    fs.writeFileSync(lockFile, '{not valid json');

    const result = acquireApplyLock(tmpInstall, 'plan-recovery');
    expect(result.ok).toBe(true);
    if (result.ok) {
      // We now own a freshly-written lock.
      const after = JSON.parse(fs.readFileSync(lockFile, 'utf-8')) as {
        pid: number;
        planId: string;
      };
      expect(after.pid).toBe(process.pid);
      expect(after.planId).toBe('plan-recovery');
      result.release();
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

    it("returns false on EPERM (process exists, we just can't signal it)", () => {
      // EPERM means another user owns the pid — same machine, but our
      // process can't send signal 0. Treating that as "stale, steal the
      // lock" would let two wizards stomp each other when running under
      // different users. Lock-stealing must require ESRCH-confirmed
      // process death.
      const holder: ApplyLockHolder = {
        pid: 99_999_998,
        startedAt: new Date().toISOString(),
        planId: 'p',
      };
      const spy = vi.spyOn(process, 'kill').mockImplementation((): true => {
        const err = new Error('EPERM') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      });
      try {
        expect(isStale(holder)).toBe(false);
      } finally {
        spy.mockRestore();
      }
    });

    it('returns false on unexpected errno codes (conservative — never steal)', () => {
      // Any errno that isn't ESRCH/EPERM falls into the catch-all "be
      // conservative" branch. If a future Node version surfaces a new
      // error code we don't know about, default to NOT stealing the
      // lock. Inverting this would let bizarre OS conditions trigger
      // double-applies.
      const holder: ApplyLockHolder = {
        pid: 99_999_997,
        startedAt: new Date().toISOString(),
        planId: 'p',
      };
      const spy = vi.spyOn(process, 'kill').mockImplementation((): true => {
        const err = new Error('weird') as NodeJS.ErrnoException;
        err.code = 'EWEIRD';
        throw err;
      });
      try {
        expect(isStale(holder)).toBe(false);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
