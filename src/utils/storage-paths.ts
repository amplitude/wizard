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
 *      Houses artifacts the user is meant to see and may want to keep:
 *      `events.json` (the approved event plan, useful for re-instrumentation)
 *      and `dashboard.json` (the dashboard URL the agent created).
 *      Gitignored as a single `.amplitude/` line.
 *
 * Unchanged (governed by external contracts):
 *   - `~/.ampli.json` — OAuth tokens; ampli CLI compatibility
 *   - macOS Keychain / Linux `secret-tool` — API keys; OS-managed
 *   - `<installDir>/.env.local` — API key fallback
 *   - `<installDir>/ampli.json` — ampli CLI tracking-plan config
 */

import { mkdirSync } from 'node:fs';
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
 */
export function projectHash(installDir: string): string {
  return createHash('sha256').update(installDir).digest('hex').slice(0, 12);
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

// ── Per-user files (no installDir scope) ──────────────────────────────

/** Plans dir (`<cacheRoot>/plans/`). One JSON file per plan ID. */
export function getPlansDir(): string {
  return join(getCacheRoot(), 'plans');
}

/** Resolve a plan file path from its ID. */
export function getPlanFile(planId: string): string {
  return join(getPlansDir(), `${planId}.json`);
}

/** Per-attempt agent recovery snapshot. */
export function getStateFile(attemptId: string): string {
  return join(getCacheRoot(), 'state', `${attemptId}.json`);
}

/** Per-user npm registry latest-version cache. */
export function getUpdateCheckFile(): string {
  return join(getCacheRoot(), 'update-check.json');
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
 */
export const LEGACY_PATHS = {
  /** Hardcoded global log (collided across parallel runs). */
  log: '/tmp/amplitude-wizard.log',
  logl: '/tmp/amplitude-wizard.logl',
  /** Global benchmark file (was clobbered across projects). */
  benchmark: (): string => join(tmpdir(), 'amplitude-wizard-benchmark.json'),
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
