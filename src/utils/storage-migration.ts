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
 *   /tmp/amplitude-wizard.logl                           → <cacheRoot>/bootstrap.ndjson
 *   $TMPDIR/amplitude-wizard-update-check.json           → <cacheRoot>/update-check.json
 *   $TMPDIR/amplitude-wizard-checkpoint-<hash>.json      → <runDir(installDir)>/checkpoint.json
 *   /tmp/amplitude-wizard-benchmark.json                 → <runDir(installDir)>/benchmark.json
 *   $TMPDIR/amplitude-wizard-state-<id>.json             → <cacheRoot>/state/<id>.json
 *   $TMPDIR/amplitude-wizard-plans/                      → <cacheRoot>/plans/
 *   <installDir>/.amplitude-events.json                  → <installDir>/.amplitude/events.json
 *   <installDir>/.amplitude-dashboard.json               → <installDir>/.amplitude/dashboard.json
 *
 * Migration is idempotent: if the new path already exists, we leave the old
 * file in place (cleanup hooks remove it later) instead of overwriting.
 */

import {
  copyFileSync,
  existsSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { atomicWriteJSON } from './atomic-write';
import { logToFile } from './debug';
import {
  ensureDir,
  getCacheRoot,
  getCheckpointFile,
  getBenchmarkFile,
  getDashboardFile,
  getEventsFile,
  getLegacyTmpdir,
  getPlansDir,
  getProjectMetaDir,
  getStateFile,
  getUpdateCheckFile,
  LEGACY_PATHS,
  projectHash,
} from './storage-paths';

/**
 * Sentinel file dropped under the cache root once the EXPENSIVE
 * user-scoped migration steps complete. Versioned (`v1`) so future
 * migrations can trigger another pass without invalidating the rest
 * of the cache root.
 *
 * Skips on subsequent runs:
 *   - `readdirSync(tmpdir())` to find legacy `amplitude-wizard-state-*` files
 *   - `readdirSync(<tmpdir>/amplitude-wizard-plans)` to migrate the plans dir
 *   - moves of the legacy log / structured-log / update-check files
 *
 * Per-project migration steps (`<installDir>/.amplitude-events.json`,
 * `.amplitude-dashboard.json`, the per-project checkpoint) intentionally
 * run on every wizard startup regardless of the sentinel. Those are
 * cheap (`existsSync` checks, no tmpdir scans), and gating them with
 * the global sentinel would skip migration for any project the user
 * runs the wizard against AFTER the first one — losing crash-recovery
 * state and the preserved-across-runs event plan for every subsequent
 * project.
 */
const SENTINEL_FILENAME = '.migrated-v1';

function getSentinelPath(): string {
  return join(getCacheRoot(), SENTINEL_FILENAME);
}

/**
 * Whether the user-scoped migration steps have already finished. Per-project
 * steps still run regardless; this flag only controls the expensive
 * `readdirSync(tmpdir())` and plans-dir scans.
 */
function userScopedMigrationDone(): boolean {
  try {
    return existsSync(getSentinelPath());
  } catch {
    return false;
  }
}

function writeSentinel(): void {
  try {
    ensureDir(getCacheRoot());
    // Atomic write (temp-file + rename) so two concurrent first-run
    // wizards don't observe a half-written sentinel and both re-do the
    // expensive `readdirSync(tmpdir())` scan. Stored as JSON so the
    // file is self-describing if a future migration needs to bump the
    // version.
    atomicWriteJSON(getSentinelPath(), {
      version: 1,
      migratedAt: Date.now(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToFile(`storage-migration: failed to write sentinel: ${msg}`);
  }
}

/**
 * Move a single file `from → to`. No-op if `from` is missing. Behavior
 * when `to` already exists depends on `preserveLegacy`:
 *
 *   - `preserveLegacy=false` (default, tmpdir-scoped legacies like logs,
 *     plans, agent state): the old file is unlinked once we've confirmed
 *     the new one exists. Safe because nothing else writes those legacy
 *     paths during a wizard run.
 *
 *   - `preserveLegacy=true` (per-project events.json, dashboard.json):
 *     leave the legacy file untouched. The agent and bundled integration
 *     skills still write the legacy dotfile during a run, so a
 *     concurrent wizard observing `existsSync(to)` and unlinking the
 *     legacy can clobber the in-flight write. The agent's next watcher
 *     tick picks the freshest file via mtime regardless.
 *
 * Silent on errors.
 *
 * Cross-filesystem safety: legacy paths often live in tmpfs (`$TMPDIR`,
 * `/tmp`) while the new cache root is under `$HOME`. On Linux these are
 * commonly two different filesystems, and `renameSync` throws `EXDEV`
 * across mounts. We try `renameSync` first (atomic, fastest) and fall
 * back to `copyFileSync + renameSync` on `EXDEV`. The fallback uses a
 * `<to>.tmp` staging file so a kill mid-copy never leaves a truncated
 * destination at `to` — which would make a future run see `existsSync(to)`
 * and unlink the still-good source.
 */
function moveFile(
  from: string,
  to: string,
  options: { preserveLegacy?: boolean } = {},
): boolean {
  const { preserveLegacy = false } = options;
  try {
    if (!existsSync(from)) return false;
    if (existsSync(to)) {
      // Both exist — assume the new file is authoritative.
      if (!preserveLegacy) {
        try {
          unlinkSync(from);
        } catch {
          // Ignore
        }
      }
      return false;
    }
    // Use `path.dirname` so backslash-separated paths on Windows are
    // handled correctly. A naïve `lastIndexOf('/')` returns -1 for
    // `C:\Users\...` and would point us at the filesystem root.
    ensureDir(dirname(to));
    try {
      renameSync(from, to);
    } catch (err) {
      // On Linux, /tmp is often tmpfs while $HOME lives on a different
      // filesystem; renameSync throws EXDEV across mounts. Fall back to
      // copy-to-tmp + rename for cross-device moves so the destination
      // only appears once it's whole. Re-throw any other error.
      if (
        err instanceof Error &&
        (err as NodeJS.ErrnoException).code === 'EXDEV'
      ) {
        const stagingPath = `${to}.tmp`;
        try {
          copyFileSync(from, stagingPath);
          renameSync(stagingPath, to);
        } catch (copyErr) {
          // Clean up the staging file so a partial copy doesn't linger.
          try {
            unlinkSync(stagingPath);
          } catch {
            // Ignore — staging may not exist if copyFileSync failed early.
          }
          throw copyErr;
        }
        try {
          unlinkSync(from);
        } catch {
          // Destination is in place; the next migration run will see
          // `existsSync(to)` and clean up the source.
        }
      } else {
        throw err;
      }
    }
    logToFile(`storage-migration: moved ${from} → ${to}`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToFile(`storage-migration: failed to move ${from} → ${to}: ${msg}`);
    return false;
  }
}

/**
 * Run the one-shot migration. Pass the resolved `installDir` so per-project
 * legacy paths (events, dashboard, checkpoint) can be migrated. Pass
 * `undefined` for global-only commands (e.g. `whoami`) — only the user-wide
 * legacy paths get migrated.
 *
 * Two-tier idempotency:
 *
 *   - User-scoped steps (legacy log files, plans dir, agent-state scan)
 *     run once per cache root. Writing `<cacheRoot>/.migrated-v1` after
 *     they finish lets us skip the `readdirSync(tmpdir())` scan on
 *     subsequent startups.
 *
 *   - Per-project steps (events, dashboard, checkpoint) run on EVERY
 *     wizard startup regardless of the sentinel. Otherwise the second
 *     project a user runs the wizard against would silently lose its
 *     legacy `.amplitude-events.json` etc. — the sentinel from the
 *     first project would tell us "already migrated" even though
 *     project B's files have never been touched.
 */
export function runMigrationShim(installDir?: string): void {
  try {
    if (!userScopedMigrationDone()) {
      // 1. Cache root: log + structured log + update-check.
      // The legacy `.logl` extension was a quirk of `+ 'l'` string-concat;
      // the new layout uses `.ndjson` everywhere (matches
      // `getStructuredLogFile`).
      moveFile(LEGACY_PATHS.log, join(getCacheRoot(), 'bootstrap.log'));
      moveFile(LEGACY_PATHS.logl, join(getCacheRoot(), 'bootstrap.ndjson'));
      moveFile(LEGACY_PATHS.updateCheck(), getUpdateCheckFile());

      // 2. Cache root: agent-state files (per-attempt; rare to have
      //    leftovers but cheap to migrate the whole pattern). Reads
      //    every entry under `tmpdir()` — gated by the sentinel so
      //    we don't repeat the scan on every startup.
      migrateStateFiles();

      // 3. Cache root: plans directory (whole tree).
      migratePlansDir();

      // Mark the user-scoped migration complete. Written before the
      // per-project block so a per-project failure (rare) doesn't
      // force the expensive scans to repeat.
      writeSentinel();
    }

    // 4. Per-project: checkpoint + benchmark + events + dashboard. These
    //    are cheap `existsSync` checks per file, so we run them on every
    //    wizard startup. Gating them with the global sentinel would
    //    silently skip migration for the second-and-onward project the
    //    user runs the wizard against.
    if (installDir) {
      const hash = projectHash(installDir);
      moveFile(LEGACY_PATHS.checkpoint(hash), getCheckpointFile(installDir));
      // The old benchmark file was global (one shared file across all
      // projects), so its contents may belong to a different project. Only
      // move if the new per-project benchmark doesn't already exist; if both
      // exist, the new one wins and the old one gets cleaned up.
      // Path is hardcoded `/tmp/...` to match the old
      // `middleware/config.ts` default — see `LEGACY_PATHS.benchmark`
      // for why we don't derive it from `tmpdir()`.
      const oldBenchmark = LEGACY_PATHS.benchmark;
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
      // `preserveLegacy: true` because the agent + bundled integration
      // skills still write the legacy dotfile during a run; a concurrent
      // wizard observing `existsSync(canonical)` must NOT unlink the
      // legacy mid-write or it clobbers the agent's fresh content.
      ensureDir(getProjectMetaDir(installDir), 0o755);
      moveFile(LEGACY_PATHS.events(installDir), getEventsFile(installDir), {
        preserveLegacy: true,
      });
      moveFile(
        LEGACY_PATHS.dashboard(installDir),
        getDashboardFile(installDir),
        { preserveLegacy: true },
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToFile(`storage-migration: top-level error: ${msg}`);
  }
}

function migrateStateFiles(): void {
  // Routes through `getLegacyTmpdir()` so tests can isolate the scan via
  // AMPLITUDE_WIZARD_LEGACY_TMPDIR — without that, two parallel test files
  // sharing the OS tmpdir would race each other's migration scans and the
  // first one to finish would migrate the OTHER test's fixture before the
  // other test could assert on it.
  const root = getLegacyTmpdir();
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  const prefix = 'amplitude-wizard-state-';
  for (const name of entries) {
    if (!name.startsWith(prefix) || !name.endsWith('.json')) continue;
    const attemptId = name.slice(prefix.length, -'.json'.length);
    moveFile(join(root, name), getStateFile(attemptId));
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
