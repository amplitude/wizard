/**
 * Single source of truth for every path the wizard reads or writes.
 *
 * Two storage roots:
 *
 *   1. Per-user cache root — `~/.amplitude/wizard/`
 *      Houses logs, checkpoints, benchmarks, plans, agent state, update-check
 *      cache. Per-project files live under `runs/<sha256(installDir)>/` so two
 *      parallel wizard instances in different directories can't collide on a
 *      shared log file.
 *
 *      Override with `AMPLITUDE_WIZARD_CACHE_DIR` env var (used by tests and
 *      by users who want the cache somewhere else).
 *
 *   2. Per-project metadata dir — `<installDir>/.amplitude/`
 *      Houses artifacts the user is meant to see and may want to commit or
 *      keep locally: `events.json` (approved event plan),
 *      `project-binding.json` (wizard org/project/source binding), and
 *      `dashboard.json` (dashboard URL — often gitignored as machine-local).
 *
 * Per-user OAuth session (access/refresh tokens) lives in the cache root as
 * `oauth-session.json` (mode `0o600`). Legacy `~/.ampli.json` is still read
 * once for migration and kept in sync on write until fully retired.
 *
 * Project binding is also written to `<installDir>/ampli.json` during
 * transition so older tooling that still looks there continues to work.
 *
 * Unchanged paths:
 *   - `<installDir>/.env.local` — API key fallback
 *
 * Recently moved into the per-user cache root:
 *   - `~/.amplitude/wizard/credentials.json` — Amplitude project API keys,
 *     keyed by hashed install dir. Replaces the macOS Keychain / Linux
 *     `secret-tool` storage that triggered an OS unlock prompt on every
 *     launch (the wizard's project API key is a public ingestion key
 *     embedded in client SDK bundles, so file-on-disk at `0o600` matches
 *     its actual sensitivity — same precedent as the OAuth session file).
 */

import { mkdirSync, realpathSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// ── Cache root ────────────────────────────────────────────────────────

/** Env var that overrides the cache root. Primarily for tests. */
export const CACHE_ROOT_OVERRIDE_ENV = 'AMPLITUDE_WIZARD_CACHE_DIR';

/**
 * Per-user cache root. Defaults to `~/.amplitude/wizard/`. Honors
 * `AMPLITUDE_WIZARD_CACHE_DIR` for test isolation and power users.
 */
export function getCacheRoot(): string {
  const override = process.env[CACHE_ROOT_OVERRIDE_ENV];
  if (override && override.length > 0) return override;
  return join(homedir(), '.amplitude', 'wizard');
}

// ── Project hashing ───────────────────────────────────────────────────

/**
 * Stable 12-char hex identifier for an install directory. Matches the
 * convention previously inlined in `session-checkpoint.ts` so existing
 * checkpoints remain addressable after migration.
 *
 * Normalization (so symlink/trailing-slash/case variants of the same
 * project hash to the same directory):
 *   1. Resolve symlinks via `realpathSync`. Falls back to the raw input
 *      if the path doesn't exist yet (ENOENT) or we can't read it
 *      (EACCES) — those are best-effort, not blockers.
 *   2. Strip trailing path separators so `/foo/bar` and `/foo/bar/`
 *      hash identically.
 */
export function projectHash(installDir: string): string {
  let resolved = installDir;
  try {
    resolved = realpathSync(installDir);
  } catch {
    // ENOENT / EACCES / EPERM — fall back to the raw string so a
    // not-yet-created install dir still hashes deterministically.
  }
  const normalized = resolved.replace(/[/\\]+$/, '');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

// ── Per-project run dir (under cache root) ────────────────────────────

/** Per-project run dir: `<cacheRoot>/runs/<hash>/`. */
export function getRunDir(installDir: string): string {
  return join(getCacheRoot(), 'runs', projectHash(installDir));
}

/** Human-readable log file. */
export function getLogFile(installDir: string): string {
  return join(getRunDir(installDir), 'log.txt');
}

/** Structured (NDJSON) log mirror. */
export function getStructuredLogFile(installDir: string): string {
  return join(getRunDir(installDir), 'log.ndjson');
}

/** Benchmark middleware output. */
export function getBenchmarkFile(installDir: string): string {
  return join(getRunDir(installDir), 'benchmark.json');
}

/** Crash-safe session checkpoint. */
export function getCheckpointFile(installDir: string): string {
  return join(getRunDir(installDir), 'checkpoint.json');
}

/**
 * Build a dated installation-error log path. Each `npm install` failure gets
 * its own file under the project's run dir so the support bundle picks them
 * up without polluting the user's project root.
 */
export function getInstallationErrorLogFile(installDir: string): string {
  return join(getRunDir(installDir), `installation-error-${Date.now()}.log`);
}

/**
 * Per-project apply lockfile. Carries the pid + start timestamp of an
 * in-flight `wizard apply` so a second concurrent invocation can detect
 * it and refuse cleanly. Lives under the per-project run dir so two
 * applies in DIFFERENT projects don't collide. The skill rule alone
 * ("never spawn a second apply") isn't enforceable on the agent side —
 * this binary-side guard catches it regardless of which orchestrator
 * is driving the wizard.
 */
export function getApplyLockFile(installDir: string): string {
  return join(getRunDir(installDir), 'apply.lock');
}

// ── Per-user files (no installDir scope) ──────────────────────────────

/** Plans dir (`<cacheRoot>/plans/`). One JSON file per plan ID. */
export function getPlansDir(): string {
  return join(getCacheRoot(), 'plans');
}

/** Resolve a plan file path from its ID. */
export function getPlanFile(planId: string): string {
  return join(getPlansDir(), `${planId}.json`);
}

/**
 * Per-attempt agent recovery snapshot. Scoped by both `attemptId` AND the
 * owning process's pid so a crashed-prior-run snapshot can't be silently
 * picked up by a fresh process that happens to reuse the same attempt id.
 *
 * The pid suffix is the load-bearing piece: PreCompact persists state for
 * the current run, and the post-compaction UserPromptSubmit hook reads it
 * back inside the SAME process. A different process should never hydrate
 * from another process's snapshot, even if attempt ids collide.
 */
export function getStateFile(
  attemptId: string,
  pid: number = process.pid,
): string {
  return join(getCacheRoot(), 'state', `${attemptId}-${pid}.json`);
}

/** Per-user npm registry latest-version cache. */
export function getUpdateCheckFile(): string {
  return join(getCacheRoot(), 'update-check.json');
}

/**
 * Per-user credentials file holding Amplitude project API keys, keyed by
 * hashed install dir. Always written at mode `0o600`. Replaces the previous
 * macOS Keychain / Linux `secret-tool` storage (which prompted on every read).
 */
export function getCredentialsFile(): string {
  return join(getCacheRoot(), 'credentials.json');
}

/**
 * Per-user OAuth session file (tokens + wizard `User-*` entries).
 * Always written at mode `0o600`.
 */
export function getOAuthSettingsFile(): string {
  return join(getCacheRoot(), 'oauth-session.json');
}

/**
 * Legacy per-user OAuth file. Read for one-shot migration; still updated on
 * write so older workflows that expect this path keep working during transition.
 */
export function getLegacyAmpliHomeOAuthPath(): string {
  return join(homedir(), '.ampli.json');
}

/**
 * Path for a downloaded skill bundle (zip). Lives under `os.tmpdir()` because
 * it's a transient download immediately extracted into `<installDir>/.claude/`.
 * `os.tmpdir()` is used (not literal `/tmp/`) so the wizard works on Windows.
 */
export function skillDownloadPath(skillId: string): string {
  return join(tmpdir(), `amplitude-skill-${skillId}.zip`);
}

// ── Per-project metadata dir (in user's project root) ─────────────────

/** Per-project metadata dir: `<installDir>/.amplitude/`. */
export function getProjectMetaDir(installDir: string): string {
  return join(installDir, '.amplitude');
}

/** Approved event plan written by `confirm_event_plan`. Persists across runs. */
export function getEventsFile(installDir: string): string {
  return join(getProjectMetaDir(installDir), 'events.json');
}

/** Dashboard URL JSON written by the agent after dashboard creation. */
export function getDashboardFile(installDir: string): string {
  return join(getProjectMetaDir(installDir), 'dashboard.json');
}

/**
 * Optional machine-readable hints for the wizard-proxy dashboard RPC
 * (`POST /dashboards`): grounded autocapture flag, display name, SDK version.
 * Written by the agent after SDK init / taxonomy — see wizard supplement refs.
 */
export function getWizardContextFile(installDir: string): string {
  return join(getProjectMetaDir(installDir), 'wizard-context.json');
}

/**
 * Canonical wizard project binding (org, project, source, zone, app id, etc.).
 * Legacy `ampli.json` in the project root is still read/written during transition.
 */
export function getProjectBindingFile(installDir: string): string {
  return join(getProjectMetaDir(installDir), 'project-binding.json');
}

/**
 * Pick the freshest existing file from a list of candidate paths, comparing
 * by mtime. Used to prefer the canonical project-meta path over a legacy
 * fallback when both exist. Returns `null` if none of the paths point at a
 * regular file.
 *
 * Intentionally lives in `storage-paths.ts` (zero non-stdlib deps) so the
 * intro / outro screens can depend on it without dragging in the heavier
 * `agent-interface.ts` dep graph for what is fundamentally a 5-line stat
 * loop.
 */
export function pickFreshestExisting(paths: readonly string[]): string | null {
  let chosenPath: string | null = null;
  let chosenMtime = -Infinity;
  for (const p of paths) {
    try {
      const stat = statSync(p);
      if (stat.isFile() && stat.mtime.getTime() > chosenMtime) {
        chosenPath = p;
        chosenMtime = stat.mtime.getTime();
      }
    } catch {
      // ENOENT / EACCES — file's just not there, that's fine.
    }
  }
  return chosenPath;
}

// ── Directory creation ────────────────────────────────────────────────

/**
 * Best-effort recursive mkdir. The caller should not depend on the return
 * value; failures are silent (most consumers race the directory and the
 * subsequent file write surfaces a more useful error). Cache directories
 * are created with `0o700` so the cache root and per-run dirs are owner-only.
 */
export function ensureDir(dir: string, mode = 0o700): void {
  try {
    mkdirSync(dir, { recursive: true, mode });
  } catch {
    // Best-effort
  }
}

// ── Legacy paths (one-shot migration) ─────────────────────────────────

/**
 * Pre-refactor paths. Kept here so the startup migration shim has a single
 * source of truth for "where the old layout used to put things." Drop after
 * one release.
 *
 * NB: `log` and `logl` are deliberately hardcoded to `/tmp/...` even though
 * `tmpdir()` returns `/var/folders/...` on macOS. The OLD logger always
 * wrote to the literal `/tmp/amplitude-wizard.log` (see git blame on
 * `src/lib/observability/logger.ts` before this refactor); macOS resolves
 * `/tmp` as a symlink to `/private/tmp` transparently for both reads and
 * writes, so the migration finds whatever the old logger wrote.
 */
export const LEGACY_PATHS = {
  /** Hardcoded global log (collided across parallel runs). */
  log: '/tmp/amplitude-wizard.log',
  logl: '/tmp/amplitude-wizard.logl',
  /**
   * Global benchmark file (was clobbered across projects). Hardcoded
   * to literal `/tmp/` to match the old `middleware/config.ts` default
   * (`benchmarkPath: '/tmp/amplitude-wizard-benchmark.json'`). On macOS
   * `tmpdir()` is `/var/folders/...`, so deriving from it would have
   * silently missed the legacy file during migration.
   */
  benchmark: '/tmp/amplitude-wizard-benchmark.json',
  /** Per-project checkpoint, tmpdir-scoped. */
  checkpoint: (hash: string): string =>
    join(tmpdir(), `amplitude-wizard-checkpoint-${hash}.json`),
  /** Per-attempt agent state, tmpdir-scoped. */
  state: (attemptId: string): string =>
    join(tmpdir(), `amplitude-wizard-state-${attemptId}.json`),
  /** Plans dir, tmpdir-scoped. */
  plansDir: (): string => join(tmpdir(), 'amplitude-wizard-plans'),
  /** Update-check cache, tmpdir-scoped. */
  updateCheck: (): string =>
    join(tmpdir(), 'amplitude-wizard-update-check.json'),
  /** Per-project events file, dotfile in install dir. */
  events: (installDir: string): string =>
    join(installDir, '.amplitude-events.json'),
  /** Per-project dashboard file, dotfile in install dir. */
  dashboard: (installDir: string): string =>
    join(installDir, '.amplitude-dashboard.json'),
} as const;
