/**
 * Self-heal stale per-project state on startup.
 *
 * The bug this guards against: after a `git reset` (or manual deletion of
 * the wizard's project binding), the wizard's per-project caches can still
 * point at the prior org/project/API key. The classic symptom is a stored
 * API key for an install dir that has no binding at all — we want to clear
 * that key so the user re-authenticates against whichever project they pick
 * next.
 *
 *   - `<installDir>/.amplitude/project-binding.json` ── canonical wizard
 *     binding (org/project/source/zone/app id). Gitignored. Survives
 *     `git reset` on its own, but the user often nukes `.amplitude/`
 *     manually when "starting fresh".
 *
 *   - `<installDir>/ampli.json` ── legacy binding mirror. Tracked in git
 *     historically; Phase G-1 (#573) stopped writing it for fresh projects,
 *     so its absence is now the NORMAL state for any project initialized
 *     post-G1. **Bare absence is no longer a self-heal signal.**
 *
 *   - `<installDir>/.amplitude/events.json` / `dashboard.json` ──
 *     gitignored per-project artifacts (approved event plan, dashboard URL).
 *     We deliberately preserve these so users can resume an aborted run.
 *
 *   - `~/.amplitude/wizard/runs/<sha256(installDir)>/checkpoint.json` ──
 *     per-user cache: region, selected org/project IDs, framework detection.
 *
 *   - `~/.amplitude/wizard/credentials.json` ── per-user, keyed by
 *     install-dir hash. Holds the API key for the prior project.
 *
 *   - Legacy `.amplitude-events.json` / `.amplitude-dashboard.json` dotfiles
 *     in the project root — pre-`<installDir>/.amplitude/` layout. Real
 *     `git reset` artifacts when paired with a stale credential.
 *
 * Heuristic (post-G1, tightened in this commit):
 *
 *   - Healthy when EITHER `project-binding.json` OR `ampli.json` exists.
 *     No-op.
 *
 *   - When neither binding exists AND a stored API key for this install
 *     dir is still in `credentials.json`, that's an orphaned credential —
 *     a real `git reset` symptom. Clear the credential entry only;
 *     `.amplitude/events.json` is preserved so the user can resume.
 *     Disk presence of `project-binding.json` is re-checked immediately
 *     before the destructive `clearApiKey` call — this guarantees the
 *     cred-clear is gated on a *current* missing file, never on a stale
 *     read or on a polled signal like `hasAnyEvents=false` from an
 *     activation check.
 *
 *   - When neither binding exists AND legacy `.amplitude-events.json` /
 *     `.amplitude-dashboard.json` dotfiles exist AND a stored API key is
 *     present, also wipe the legacy dotfiles (they're real `git reset`
 *     artifacts in the pre-`.amplitude/` layout).
 *
 *   - Otherwise (no binding, no stored key) → no-op. Bare ampli.json
 *     absence on a fresh-cloned project is the post-G1 default and must
 *     not nuke the user's events/checkpoint.
 *
 * User-level state (`~/.ampli.json` OAuth tokens, credentials for OTHER
 * install dirs) is never touched — the user stays signed in and other
 * projects' bindings stay intact.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { AMPLI_CONFIG_FILENAME } from './ampli-config.js';
import { logToFile } from '../utils/debug.js';
import { clearApiKey, readApiKey } from '../utils/api-key-store.js';
import { getProjectBindingFile } from '../utils/storage-paths.js';

export interface SelfHealResult {
  healed: boolean;
  /** Human-readable reason. Useful in logs / telemetry. */
  reason: string;
  /** Filesystem paths (or symbolic markers) actually removed. */
  artifactsRemoved: string[];
}

/**
 * Detect and fix inconsistent per-project state caused by a `git reset` or
 * manual deletion of the wizard's project binding. Safe to call
 * unconditionally at startup — no-ops on fresh projects and on healthy
 * projects.
 *
 * Synchronous so the startup path doesn't have to await a microtask before
 * `loadCheckpoint`/`resolveCredentials` run.
 */
export function selfHealStaleProjectState(installDir: string): SelfHealResult {
  // Defensive: bail if installDir is missing. A bin.ts code path that
  // hands us undefined would otherwise propagate into `realpathSync` /
  // path-join calls — best to fail loud-but-graceful here.
  if (!installDir) {
    return {
      healed: false,
      reason: 'installDir not set — skipping self-heal',
      artifactsRemoved: [],
    };
  }

  const bindingFile = getProjectBindingFile(installDir);
  const legacyAmpliJson = path.join(installDir, AMPLI_CONFIG_FILENAME);
  const hasBinding = safeExists(bindingFile) || safeExists(legacyAmpliJson);

  // Healthy state: at least one binding source is present.
  if (hasBinding) {
    return {
      healed: false,
      reason:
        'project-binding.json or ampli.json present — caches are consistent',
      artifactsRemoved: [],
    };
  }

  // Detect a stored API key for this install dir. This is the load-bearing
  // signal post-G1 — bare ampli.json absence is no longer a signal because
  // the wizard hasn't written ampli.json on healthy projects since #573.
  let hasStoredKey = false;
  try {
    hasStoredKey = readApiKey(installDir) !== null;
  } catch {
    // If we can't read the credentials file, treat as "no stored key".
  }

  if (!hasStoredKey) {
    return {
      healed: false,
      reason:
        'no project binding and no stored API key — fresh / post-G1 project, nothing to heal',
      artifactsRemoved: [],
    };
  }

  // From here on: no binding + stored API key. That's the real `git reset`
  // (or manual-cleanup) symptom we want to fix. Clear the orphan credential
  // entry so the user re-authenticates against whichever project they pick
  // next. Crucially we do NOT touch `.amplitude/events.json` / `dashboard.json`
  // / the user's checkpoint — preserving them lets the user resume an
  // aborted run after a transient crash, and they're harmless without a
  // matching credential.
  //
  // Defense-in-depth: re-check the canonical binding file on disk
  // IMMEDIATELY before the destructive `clearApiKey` call. The early
  // `hasBinding` gate above could in principle observe a transient
  // false-negative (e.g. a concurrent atomic-write rename racing with
  // `existsSync`, or a bug in a future caller that lands here with the
  // binding file genuinely present). A polling activation check that
  // returns `hasAnyEvents=false` should NEVER cause us to nuke a valid
  // credential — disk presence of `project-binding.json` is the only
  // signal that authorizes the cred-clear. Mirroring this check at the
  // mutation site keeps the invariant local to the line that actually
  // deletes the credential, so any reviewer can verify it without tracing
  // back ~70 lines.
  if (fs.existsSync(bindingFile)) {
    logToFile(
      '[self-heal] project-binding.json reappeared on disk between gate ' +
        'and mutation — aborting orphan-credential clear (cred preserved)',
    );
    return {
      healed: false,
      reason:
        'project-binding.json present on second-look — preserving stored credential',
      artifactsRemoved: [],
    };
  }

  const removed: string[] = [];

  // Legacy dotfile mirrors only get cleared when paired with a stale
  // credential. Otherwise they could just be leftovers that the user
  // committed in the pre-`.amplitude/` era.
  const legacyEvents = path.join(installDir, '.amplitude-events.json');
  const legacyDashboard = path.join(installDir, '.amplitude-dashboard.json');
  for (const target of [legacyEvents, legacyDashboard]) {
    if (!safeExists(target)) continue;
    try {
      fs.rmSync(target, { force: true });
      removed.push(target);
    } catch (err) {
      logToFile(
        `[self-heal] failed to remove ${target}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  try {
    clearApiKey(installDir);
    // The credentials file is shared across install dirs — we only
    // cleared this install dir's entry. Mark it symbolically so the
    // log shows what happened without leaking the path of a file that
    // holds OTHER projects' keys.
    removed.push('credentials.json[this install dir]');
  } catch (err) {
    logToFile(
      `[self-heal] failed to clear stored API key: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const reason =
    'project binding missing but stored API key present (likely git reset); cleared orphan credential';
  logToFile(
    `[self-heal] ${reason}; removed: ${
      removed.length > 0
        ? removed.join(', ')
        : '(nothing — all removals failed)'
    }`,
  );

  return {
    healed: removed.length > 0,
    reason,
    artifactsRemoved: removed,
  };
}

function safeExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}
