/**
 * One-shot migration from the old `$TMPDIR/amplitude-wizard-*` + project-root
 * dotfile layout to the new layout under:
 *
 *   ~/.amplitude/wizard/
 *   <installDir>/.amplitude/
 *
 * Safe to call from any startup path. Best-effort — silent on per-file
 * failures so a stuck file never blocks the wizard. Drop in the release
 * after this lands; stragglers lose stale logs/checkpoints, no other state.
 *
 * Migration table:
 *   /tmp/amplitude-wizard.log                            → <cacheRoot>/bootstrap.log
 *   /tmp/amplitude-wizard.logl                           → <cacheRoot>/bootstrap.logl
 *   $TMPDIR/amplitude-wizard-update-check.json           → <cacheRoot>/update-check.json
 *   $TMPDIR/amplitude-wizard-checkpoint-<hash>.json      → <runDir(installDir)>/checkpoint.json
 *   $TMPDIR/amplitude-wizard-benchmark.json              → <runDir(installDir)>/benchmark.json
 *   $TMPDIR/amplitude-wizard-state-<id>.json             → <cacheRoot>/state/<id>.json
 *   $TMPDIR/amplitude-wizard-plans/                      → <cacheRoot>/plans/
 *   <installDir>/.amplitude-events.json                  → <installDir>/.amplitude/events.json
 *   <installDir>/.amplitude-dashboard.json               → <installDir>/.amplitude/dashboard.json
 *
 * Migration is idempotent: if the new path already exists, we leave the old
 * file in place (cleanup hooks remove it later) instead of overwriting.
 */

import {
  existsSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logToFile } from './debug';
import {
  ensureDir,
  getCacheRoot,
  getCheckpointFile,
  getBenchmarkFile,
  getDashboardFile,
  getEventsFile,
  getPlansDir,
  getProjectMetaDir,
  getStateFile,
  getUpdateCheckFile,
  LEGACY_PATHS,
  projectHash,
} from './storage-paths';

/**
 * Move a single file `from → to`. No-op if `from` is missing. Skips when
 * `to` already exists (the new layout wins; old file is best-effort cleaned).
 * Silent on errors.
 */
function moveFile(from: string, to: string): boolean {
  try {
    if (!existsSync(from)) return false;
    if (existsSync(to)) {
      // Both exist — assume the new file is authoritative and just delete
      // the old one so it stops being read.
      try {
        unlinkSync(from);
      } catch {
        // Ignore
      }
      return false;
    }
    ensureDir(parentDir(to));
    renameSync(from, to);
    logToFile(`storage-migration: moved ${from} → ${to}`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToFile(`storage-migration: failed to move ${from} → ${to}: ${msg}`);
    return false;
  }
}

function parentDir(p: string): string {
  const ix = p.lastIndexOf('/');
  return ix > 0 ? p.slice(0, ix) : '/';
}

/**
 * Run the one-shot migration. Pass the resolved `installDir` so per-project
 * legacy paths (events, dashboard, checkpoint) can be migrated. Pass
 * `undefined` for global-only commands (e.g. `whoami`) — only the user-wide
 * legacy paths get migrated.
 */
export function runMigrationShim(installDir?: string): void {
  try {
    // 1. Cache root: log + structured log + update-check
    moveFile(LEGACY_PATHS.log, join(getCacheRoot(), 'bootstrap.log'));
    moveFile(LEGACY_PATHS.logl, join(getCacheRoot(), 'bootstrap.logl'));
    moveFile(LEGACY_PATHS.updateCheck(), getUpdateCheckFile());

    // 2. Cache root: agent-state files (per-attempt; rare to have leftovers
    //    but cheap to migrate the whole pattern).
    migrateStateFiles();

    // 3. Cache root: plans directory (whole tree).
    migratePlansDir();

    // 4. Per-project: checkpoint + benchmark + events + dashboard.
    if (installDir) {
      const hash = projectHash(installDir);
      moveFile(LEGACY_PATHS.checkpoint(hash), getCheckpointFile(installDir));
      // The old benchmark file was global (one shared file across all
      // projects), so its contents may belong to a different project. Only
      // move if the new per-project benchmark doesn't already exist; if both
      // exist, the new one wins and the old one gets cleaned up.
      const oldBenchmark = join(tmpdir(), 'amplitude-wizard-benchmark.json');
      if (existsSync(oldBenchmark)) {
        if (!existsSync(getBenchmarkFile(installDir))) {
          moveFile(oldBenchmark, getBenchmarkFile(installDir));
        } else {
          try {
            unlinkSync(oldBenchmark);
          } catch {
            // Best-effort
          }
        }
      }

      // Events and dashboard: the new canonical location is under
      // `<installDir>/.amplitude/`. Make sure the dir exists, then move.
      ensureDir(getProjectMetaDir(installDir), 0o755);
      moveFile(LEGACY_PATHS.events(installDir), getEventsFile(installDir));
      moveFile(
        LEGACY_PATHS.dashboard(installDir),
        getDashboardFile(installDir),
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToFile(`storage-migration: top-level error: ${msg}`);
  }
}

function migrateStateFiles(): void {
  let entries: string[];
  try {
    entries = readdirSync(tmpdir());
  } catch {
    return;
  }
  const prefix = 'amplitude-wizard-state-';
  for (const name of entries) {
    if (!name.startsWith(prefix) || !name.endsWith('.json')) continue;
    const attemptId = name.slice(prefix.length, -'.json'.length);
    moveFile(join(tmpdir(), name), getStateFile(attemptId));
  }
}

function migratePlansDir(): void {
  const oldDir = LEGACY_PATHS.plansDir();
  if (!existsSync(oldDir)) return;
  let entries: string[];
  try {
    entries = readdirSync(oldDir);
  } catch {
    return;
  }
  const newDir = getPlansDir();
  ensureDir(newDir);
  for (const name of entries) {
    moveFile(join(oldDir, name), join(newDir, name));
  }
  // Try to remove the now-empty legacy dir; ignore if non-empty.
  try {
    const remaining = readdirSync(oldDir);
    if (remaining.length === 0) {
      try {
        rmdirSync(oldDir);
      } catch {
        // Ignore
      }
    }
  } catch {
    // Ignore
  }
}
