/**
 * Self-heal stale per-project state on startup.
 *
 * The bug this guards against: after a `git reset` (or manual deletion of
 * `<installDir>/ampli.json`), the wizard's per-project caches are still
 * pointing at the prior org/project/API key.
 *
 *   - `<installDir>/ampli.json`  ── source of truth for "this codebase is
 *     bound to an Amplitude project". Tracked in git, so `git reset` wipes
 *     it whenever the user resets past the commit that introduced it.
 *
 *   - `<installDir>/.amplitude/` ── gitignored. Survives `git reset`.
 *     Holds `events.json` (approved event plan) and `dashboard.json`
 *     (created dashboard URL).
 *
 *   - `~/.amplitude/wizard/runs/<sha256(installDir)>/checkpoint.json` ──
 *     per-user cache. Survives `git reset`. Holds region, selected org/
 *     project IDs, framework detection, intro state.
 *
 *   - `~/.amplitude/wizard/credentials.json` ── per-user, keyed by
 *     install-dir hash. Survives `git reset`. Holds the API key used for
 *     the prior project.
 *
 * Without healing, `bin.ts` does:
 *   1. `loadCheckpoint()` → `Object.assign(session, checkpoint)`
 *      (now `session.selectedOrgId/ProjectId/region/introConcluded` are
 *      pre-populated from the stale checkpoint)
 *   2. `resolveCredentials()` reads the stale API key from credentials.json
 *      and wires `session.credentials` from it. The safety check at
 *      `credential-resolution.ts:576` does NOT fire because `selectedOrgId`
 *      is set (from the checkpoint).
 *   3. `requiresAccountConfirmation` is true, so the user lands on
 *      "Continue with this Amplitude project?" pointing at a project they
 *      thought they wiped — or worse, the OAuth flow is skipped entirely
 *      and the wizard silently routes them past auth.
 *
 * The user's mental model is "git reset = clean slate". This module makes
 * the wizard agree with that mental model.
 *
 * Heuristic: ampli.json missing AND any per-project cache present →
 * inconsistent state, wipe per-project caches. User-level state
 * (`~/.ampli.json` OAuth tokens, credentials for OTHER install dirs) is
 * never touched — the user stays signed in, they just have to re-pick a
 * project for this codebase.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { ampliConfigExists } from './ampli-config.js';
import { logToFile } from '../utils/debug.js';
import { clearApiKey, readApiKey } from '../utils/api-key-store.js';
import {
  getCheckpointFile,
  getProjectMetaDir,
} from '../utils/storage-paths.js';

export interface SelfHealResult {
  healed: boolean;
  /** Human-readable reason. Useful in logs / telemetry. */
  reason: string;
  /** Filesystem paths (or symbolic markers) actually removed. */
  artifactsRemoved: string[];
}

/**
 * Detect and fix inconsistent per-project state caused by a `git reset` or
 * manual deletion of `<installDir>/ampli.json`. Safe to call unconditionally
 * at startup — no-ops on fresh projects and on healthy projects.
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

  // Healthy state: ampli.json present means this project IS bound to an
  // Amplitude project and the per-project caches are still authoritative.
  if (ampliConfigExists(installDir)) {
    return {
      healed: false,
      reason: 'ampli.json present — caches are consistent',
      artifactsRemoved: [],
    };
  }

  // ampli.json is missing. Look for stale caches that would silently feed
  // the wizard the prior project's identity.
  const checkpointPath = getCheckpointFile(installDir);
  const metaDir = getProjectMetaDir(installDir);
  const legacyEvents = path.join(installDir, '.amplitude-events.json');
  const legacyDashboard = path.join(installDir, '.amplitude-dashboard.json');

  const candidateTargets: Array<{ path: string; kind: 'file' | 'dir' }> = [
    { path: checkpointPath, kind: 'file' },
    { path: metaDir, kind: 'dir' },
    { path: legacyEvents, kind: 'file' },
    { path: legacyDashboard, kind: 'file' },
  ];
  const fileTargets = candidateTargets.filter((t) => {
    try {
      return fs.existsSync(t.path);
    } catch {
      return false;
    }
  });

  // Detect a stored API key for this install dir.
  let hasStoredKey = false;
  try {
    hasStoredKey = readApiKey(installDir) !== null;
  } catch {
    // If we can't read the credentials file, treat as "no stored key".
  }

  if (fileTargets.length === 0 && !hasStoredKey) {
    return {
      healed: false,
      reason:
        'ampli.json missing, but no per-project cache to heal — fresh project',
      artifactsRemoved: [],
    };
  }

  const removed: string[] = [];
  for (const target of fileTargets) {
    try {
      fs.rmSync(target.path, { recursive: true, force: true });
      removed.push(target.path);
    } catch (err) {
      logToFile(
        `[self-heal] failed to remove ${target.path}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  if (hasStoredKey) {
    try {
      clearApiKey(installDir);
      // The credentials file is shared across install dirs — we only
      // cleared this install dir's entry. Mark it symbolically so the
      // log shows what happened without leaking the path of a file
      // that holds OTHER projects' keys.
      removed.push('credentials.json[this install dir]');
    } catch (err) {
      logToFile(
        `[self-heal] failed to clear stored API key: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  const reason =
    'ampli.json missing but per-project state present (likely git reset)';
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
