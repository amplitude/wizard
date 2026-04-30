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
import { atomicWriteJSON } from './atomic-write.js';
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

  const existing = readLockHolder(lockFile);
  if (existing) {
    if (isStale(existing, now)) {
      // Stale: prior process gone or run too old. Steal the lock.
      try {
        fs.rmSync(lockFile, { force: true });
      } catch {
        /* best-effort */
      }
    } else {
      return { ok: false, holder: existing, reason: 'in_progress' };
    }
  }

  const holder: ApplyLockHolder = {
    pid: process.pid,
    startedAt: now.toISOString(),
    planId,
  };
  try {
    atomicWriteJSON(lockFile, holder, 0o600);
  } catch {
    // If the write fails, treat as not-locked rather than blocking
    // the caller — better to risk a second apply than to make the
    // primary path unreachable on a transient FS error.
    return { ok: true, release: () => undefined };
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
