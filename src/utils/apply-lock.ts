/**
 * Per-project apply lockfile.
 *
 * Prevents two `wizard apply` invocations from running concurrently
 * against the same install dir. Without this guard, an outer agent
 * (Claude Code, Cursor, etc.) that spawns `wizard apply` and forgets
 * to wait on the first invocation can race a second one — the inner
 * Claude SDK agents stomp each other's edits and the user gets a
 * file with track() calls inserted twice (or worse, conflicting
 * shapes). Real-world transcript: an agent backgrounded `wizard
 * --agent` 5 times before realizing the first was still running.
 *
 * Design:
 *   - File at `<runDir>/apply.lock` carries `{ pid, startedAt, planId }`.
 *   - `acquireApplyLock` writes atomically and returns either
 *     `{ ok: true, release }` or `{ ok: false, holder: ... }` so the
 *     caller can refuse with a clear message.
 *   - Stale locks (PID no longer running, or older than 30 minutes)
 *     are auto-cleared. `wizard apply` taking >30 minutes is itself
 *     a bug; treating the lock as stale is safer than wedging forever.
 *   - `release()` removes the file. Best-effort: if it fails (file
 *     gone, permission), the next acquire will treat it as stale
 *     and recover.
 *
 * Pure-ish — does fs I/O but no UI imports, so the module can be
 * exercised in isolation by unit tests with a custom installDir.
 */

import * as fs from 'node:fs';
import { getApplyLockFile, ensureDir, getRunDir } from './storage-paths.js';

/** Max age (ms) before we consider a lockfile stale and steal it. */
export const STALE_LOCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 min

export interface ApplyLockHolder {
  pid: number;
  startedAt: string; // ISO timestamp
  planId: string;
}

export type AcquireResult =
  | { ok: true; release: () => void }
  | { ok: false; holder: ApplyLockHolder; reason: 'in_progress' };

/**
 * Try to acquire the apply lock for `installDir`. If another wizard
 * apply is in progress, returns `{ ok: false, holder }` so the caller
 * can refuse with a clear message and a `kill <pid>` hint.
 *
 * Stale locks (PID gone, or older than `STALE_LOCK_THRESHOLD_MS`) are
 * cleared and re-acquired in the same call.
 */
export function acquireApplyLock(
  installDir: string,
  planId: string,
  now: Date = new Date(),
): AcquireResult {
  const lockFile = getApplyLockFile(installDir);
  ensureDir(getRunDir(installDir), 0o700);

  const holder: ApplyLockHolder = {
    pid: process.pid,
    startedAt: now.toISOString(),
    planId,
  };
  const payload = JSON.stringify(holder);

  // Try to acquire by atomically creating the lockfile with O_CREAT|O_EXCL
  // (`'wx'`). This is the only POSIX way to test-and-set on a regular file
  // without TOCTOU. Two concurrent acquirers race on `openSync`; the OS
  // serializes them, the loser gets EEXIST. The previous temp-file +
  // rename approach (`atomicWriteJSON`) is last-writer-wins and let two
  // processes both observe "no lock", both write, both believe they own
  // it — the exact race this lock was built to prevent.
  //
  // We retry once on EEXIST after checking whether the existing lock is
  // stale. Stale-steal is also race-safe: `unlinkSync` followed by
  // `openSync('wx')` lets one stealer win and the rest fail with EEXIST,
  // at which point they observe the new owner and refuse cleanly.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockFile, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, payload);
      } finally {
        fs.closeSync(fd);
      }
      const release = (): void => {
        try {
          // Only remove if WE still own the lock — a stale-steal in
          // another process may have taken it. Best-effort comparison.
          const current = readLockHolder(lockFile);
          if (current && current.pid === process.pid) {
            fs.rmSync(lockFile, { force: true });
          }
        } catch {
          /* best-effort */
        }
      };
      return { ok: true, release };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        // Non-existence error (EACCES, ENOSPC, etc.). Treat as
        // not-locked rather than blocking the caller — better to risk
        // a second apply than to make the primary path unreachable on
        // a transient FS error. Same fail-open posture as the previous
        // implementation.
        return { ok: true, release: () => undefined };
      }

      // Lockfile exists. Inspect the holder.
      const existing = readLockHolder(lockFile);
      if (!existing) {
        // File present but unparseable (truncated, foreign content). On
        // first attempt, treat as stale and unlink; on second, give up
        // and fail-open.
        if (attempt === 0) {
          try {
            fs.rmSync(lockFile, { force: true });
          } catch {
            /* best-effort */
          }
          continue;
        }
        return { ok: true, release: () => undefined };
      }
      if (isStale(existing, now) && attempt === 0) {
        // Stale: try to steal. If two stealers race, only one's
        // `rmSync`+`openSync('wx')` pair will succeed; the rest go
        // around the loop, observe the new live holder, and refuse.
        try {
          fs.rmSync(lockFile, { force: true });
        } catch {
          /* best-effort */
        }
        continue;
      }
      return { ok: false, holder: existing, reason: 'in_progress' };
    }
  }
  // Shouldn't be reachable — the loop either returns or continues at
  // most once. Defensive fail-open if we ever fall through.
  return { ok: true, release: () => undefined };
}

function readLockHolder(lockFile: string): ApplyLockHolder | null {
  try {
    if (!fs.existsSync(lockFile)) return null;
    const raw = fs.readFileSync(lockFile, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ApplyLockHolder>;
    if (
      typeof parsed.pid === 'number' &&
      typeof parsed.startedAt === 'string' &&
      typeof parsed.planId === 'string'
    ) {
      return {
        pid: parsed.pid,
        startedAt: parsed.startedAt,
        planId: parsed.planId,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * A lock is stale if either:
 *   - the PID is no longer running on this machine, OR
 *   - the lock is older than `STALE_LOCK_THRESHOLD_MS` (a wizard apply
 *     should never run that long; treating it as stale is safer than
 *     wedging forever).
 *
 * `process.kill(pid, 0)` is the standard liveness probe — sends signal
 * 0 (no-op) and throws ESRCH if the pid is gone, EPERM if we can't
 * signal it (rare, but treat as alive — same-machine + same-user).
 *
 * Exported for unit tests.
 */
export function isStale(
  holder: ApplyLockHolder,
  now: Date = new Date(),
): boolean {
  // Age check.
  const startedMs = Date.parse(holder.startedAt);
  if (Number.isFinite(startedMs)) {
    const ageMs = now.getTime() - startedMs;
    if (ageMs > STALE_LOCK_THRESHOLD_MS) return true;
  }
  // Liveness check — only if the pid is plausibly different from ours
  // (don't try to kill -0 ourselves; that's always alive).
  if (holder.pid === process.pid) return false;
  try {
    process.kill(holder.pid, 0);
    return false; // signal succeeded → process exists
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return true; // process gone
    if (code === 'EPERM') return false; // exists but signal denied
    // Any other error: be conservative, don't steal.
    return false;
  }
}
