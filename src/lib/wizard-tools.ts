/**
 * Unified in-process MCP server for the Amplitude wizard.
 *
 * Provides tools that run locally (secret values never leave the machine):
 * - check_env_keys: Check which env var keys exist in a .env file
 * - set_env_values: Create/update env vars in a .env file
 * - detect_package_manager: Detect the project's package manager(s)
 */

import path from 'path';
import fs from 'fs';
import os from 'os';
import AdmZip from 'adm-zip';
import { z } from 'zod';
import { logToFile } from '../utils/debug';
import { atomicWriteJSON } from '../utils/atomic-write';
import {
  readLocalEventPlan,
  readLocalEventPlanRich,
} from './event-plan-parser.js';
import { recordEventPlanDecision } from './agent/event-plan-feedback-state.js';
import {
  ensureDir,
  getDashboardFile,
  getEventsFile,
  getProjectMetaDir,
} from '../utils/storage-paths';
import type { PackageManagerDetector } from './package-manager-detection';
import { getUI } from '../ui';
import type { EventPlanDecision } from '../ui/wizard-ui';
import { wrapMcpServerWithSentry } from './observability/index';
import { toWizardDashboardOpenUrl } from '../utils/dashboard-open-url';
import type { SkillEntry, SkillMenu } from './wizard-tools/bundled-skills.js';
import {
  bundledSkillExists,
  isSkillTiersEnabled,
  loadBundledSkillMenu,
  readBundledSkillBody,
  readBundledSkillReference,
  SKILL_REFERENCE_REL_PATH,
} from './wizard-tools/bundled-skills.js';
import { toWizardToolErrorContent } from './wizard-tools/types.js';
export type { WizardToolErrorResponse } from './wizard-tools/types.js';
export {
  toWizardToolErrorContent,
  toWizardToolDenyMessage,
} from './wizard-tools/types.js';

export type { SkillEntry, SkillMenu } from './wizard-tools/bundled-skills.js';
export {
  loadBundledSkillMenu,
  bundledSkillExists,
  readBundledSkillBody,
  readBundledSkillReference,
  preStageSkills,
  installBundledSkill,
  isSkillTiersEnabled,
  buildSkillMenuFileContent,
  writeSkillMenuFile,
  SKILL_MENU_FILENAME,
  PRE_STAGED_CONSTANT_SKILLS,
} from './wizard-tools/bundled-skills.js';

// Allow-listed hosts for remote skill downloads. The wizard ships skills
// from amplitude/context-hub via GitHub Releases; nothing else should ever
// be a download source. Any host not on this list — including raw IPs and
// HTTP URLs — is rejected before we touch the filesystem.
const ALLOWED_SKILL_HOSTS = new Set<string>([
  'github.com',
  'objects.githubusercontent.com',
  'codeload.github.com',
]);

export function isAllowedSkillUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_SKILL_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Remote skill helpers — for future use with amplitude/context-hub releases.
// Currently unused; skills are bundled locally. Enable by setting SKILLS_URL
// env var (e.g. https://github.com/amplitude/context-hub/releases/latest/download).
// ---------------------------------------------------------------------------

/**
 * Bound on the remote skill-menu fetch. The wizard waits on this call before
 * the agent can run, so an unbounded fetch on a stuck CDN connection would
 * stall the entire setup. 15s comfortably covers a worst-case GitHub Releases
 * fetch but ensures we fall back to bundled skills instead of hanging.
 */
const SKILL_MENU_FETCH_TIMEOUT_MS = 15_000;

/**
 * Fetch the skill menu from a remote skills server (GitHub Releases).
 * Returns parsed data on success, `null` on failure (including timeout —
 * the caller falls back to bundled skills, so silently swallowing a slow
 * network is the correct behavior).
 */
export async function fetchSkillMenu(
  skillsBaseUrl: string,
): Promise<SkillMenu | null> {
  const menuUrl = `${skillsBaseUrl}/skill-menu.json`;
  logToFile(`fetchSkillMenu: fetching from ${menuUrl}`);

  // Bound the request with an AbortController so a hung CDN connection
  // doesn't stall agent startup. Timer is always cleared in `finally`.
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    SKILL_MENU_FETCH_TIMEOUT_MS,
  );
  try {
    const resp = await fetch(menuUrl, { signal: controller.signal });
    if (resp.ok) {
      const data = (await resp.json()) as SkillMenu;
      logToFile(
        `fetchSkillMenu: loaded (${
          Object.keys(data.categories).length
        } categories)`,
      );
      return data;
    }
    logToFile(`fetchSkillMenu: failed with HTTP ${resp.status}`);
    return null;
  } catch (err) {
    const isAbort =
      err instanceof Error &&
      (err.name === 'AbortError' ||
        (err as Error & { code?: string }).code === 'ABORT_ERR');
    logToFile(
      isAbort
        ? `fetchSkillMenu: timed out after ${SKILL_MENU_FETCH_TIMEOUT_MS}ms`
        : `fetchSkillMenu: error: ${
            err instanceof Error ? err.message : String(err)
          }`,
    );
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Download and extract a skill from a remote URL.
 * Installs to `<installDir>/.claude/skills/<id>/`.
 *
 * Hardened against three classes of local-attacker exploit:
 *
 * 1. **Symlink race** — the previous version wrote to a hardcoded path
 *    `/tmp/amplitude-skill-<id>.zip`. A local user could pre-create that
 *    path as a symlink to e.g. `~/.ampli.json`, and `curl -o` would follow
 *    the link and overwrite the OAuth tokens. We now use `mkdtempSync` to
 *    get a unique, mode-0700, unguessable temp directory.
 * 2. **Untrusted host** — the previous version downloaded from any URL the
 *    skill manifest contained. Skills are only ever published by
 *    amplitude/context-hub via GitHub Releases, so we allowlist the
 *    GitHub-owned hosts and reject anything else.
 * 3. **Zip-slip** — naive zip extractors will follow `../../../etc/passwd`
 *    entries straight out of the target dir. We extract into the scratch
 *    tmp dir first, then walk the result and reject any entry whose
 *    resolved real path escapes the scratch root.
 *
 * Cross-platform note: extraction goes through `adm-zip` rather than the
 * `unzip` CLI so this works on Windows (which has no `unzip` by default).
 * `adm-zip`'s API is sync, matching the rest of this function.
 */
export function downloadSkill(
  skillEntry: SkillEntry,
  installDir: string,
): { success: boolean; error?: string } {
  const { execFileSync } =
    require('child_process') as typeof import('child_process');
  const skillDir = path.join(installDir, '.claude', 'skills', skillEntry.id);

  if (!isAllowedSkillUrl(skillEntry.downloadUrl)) {
    const msg = `downloadSkill: refused untrusted URL: ${skillEntry.downloadUrl}`;
    logToFile(msg);
    return {
      success: false,
      error: 'Skill download URL is not from an allowed host',
    };
  }

  // Unique unguessable scratch dir (mode 0700) — defeats /tmp symlink races.
  // (Uses os.tmpdir() so this works on Windows too — PR 333.)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amplitude-skill-'));
  const tmpFile = path.join(tmpDir, 'skill.zip');
  const extractDir = path.join(tmpDir, 'extract');

  try {
    fs.mkdirSync(extractDir, { recursive: true });

    execFileSync('curl', [
      '-sSfL', // -f: fail on HTTP errors; -S: show errors; -L: follow redirects
      '--proto',
      '=https',
      '--max-time',
      '30',
      skillEntry.downloadUrl,
      '-o',
      tmpFile,
    ]);

    // Extract into the scratch dir, NOT directly into the target. This way
    // any zip-slip entry lands somewhere inside `extractDir` (or fails the
    // realpath check below), never inside the user's project.
    //
    // We use `adm-zip` instead of shelling out to the `unzip` CLI because
    // Windows has no `unzip` binary by default, and the previous shell-out
    // ENOENT'd for every Windows user. `adm-zip` is pure JS, sync, and
    // does its own internal zip-slip filtering — but the realpath walker
    // below remains as defense-in-depth (different code, different bugs).
    const zip = new AdmZip(tmpFile);
    // `maintainEntryPath = true` preserves directory structure;
    // `overwrite = true` matches the previous `unzip -o` semantics.
    zip.extractAllTo(extractDir, /* overwrite */ true);

    // Defense-in-depth zip-slip check: walk every extracted entry and make
    // sure its real path stays inside extractDir. `unzip` is supposed to
    // refuse `../` paths since 6.0, but we don't trust that — version skew
    // and symlink entries (which `unzip` happily creates by default) make
    // it cheap to verify.
    const extractRealRoot = fs.realpathSync(extractDir);
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        // Use lstat so we catch symlinks pointing outside without following
        // them.
        const stat = fs.lstatSync(full);
        if (stat.isSymbolicLink()) {
          // Resolve the link target relative to the link's own directory.
          const resolved = path.resolve(dir, fs.readlinkSync(full));
          if (
            resolved !== extractRealRoot &&
            !resolved.startsWith(extractRealRoot + path.sep)
          ) {
            throw new Error(
              `Zip-slip detected: symlink ${full} -> ${resolved} escapes ${extractRealRoot}`,
            );
          }
        } else {
          const real = fs.realpathSync(full);
          if (
            real !== extractRealRoot &&
            !real.startsWith(extractRealRoot + path.sep)
          ) {
            throw new Error(
              `Zip-slip detected: ${full} resolves to ${real}, outside ${extractRealRoot}`,
            );
          }
          if (entry.isDirectory()) walk(full);
        }
      }
    };
    walk(extractDir);

    // Move into the final location only after we've validated the contents.
    fs.mkdirSync(skillDir, { recursive: true });
    for (const entry of fs.readdirSync(extractDir)) {
      const src = path.join(extractDir, entry);
      const dest = path.join(skillDir, entry);
      // Remove any pre-existing file at dest so renameSync succeeds across
      // file types (matches old `unzip -o` overwrite semantics).
      try {
        fs.rmSync(dest, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      fs.renameSync(src, dest);
    }

    logToFile(
      `downloadSkill: installed ${skillEntry.id} from ${skillEntry.downloadUrl}`,
    );
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToFile(`downloadSkill: error: ${msg}`);
    return { success: false, error: msg };
  } finally {
    // Always clean up the scratch directory — never leave half-extracted
    // attacker-controlled bytes lying around in /tmp.
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  }
}

/**
 * Filename of the single archived prior report kept in the install dir.
 * Hoisted above WIZARD_GITIGNORE_PATTERNS so the array initializer can
 * reference it — without this hoist, the temporal-dead-zone forces a
 * duplicate string literal which silently drifts. Exported for tests
 * and OutroScreen so the constant doesn't drift downstream either.
 */
export const PREVIOUS_SETUP_REPORT_FILENAME =
  'amplitude-setup-report.previous.md';

/**
 * Patterns the wizard writes into the user's project that should never be
 * committed to git. Kept as a const so `ensureWizardArtifactsIgnored` has a
 * single source of truth for what to add to the user's .gitignore.
 *
 * The list is broader than what `cleanupWizardArtifacts` removes on exit:
 * several entries are kept on disk on purpose (the user-facing setup report,
 * canonical `.amplitude/` metadata, optional legacy dotfiles from older runs)
 * but selected paths should still never be committed.
 *
 * Notes on each entry:
 *   - `.amplitude/dashboard.json` — dashboard URL; often treated as
 *     machine-local. Other `.amplitude/*` files (`events.json`,
 *     `project-binding.json`) are intentionally not gitignored here so teams
 *     can commit metadata when they want.
 *   - `.amplitude-events.json` / `.amplitude-dashboard.json` — legacy paths
 *     from older wizard or skill versions. The wizard writes the canonical
 *     plan under `.amplitude/events.json` (see `persistEventPlan`) but still
 *     reads these when present; keep them gitignored so stray copies never get
 *     committed.
 *   - `amplitude-setup-report.previous.md` — wizard-managed archive of the
 *     prior run's setup report. The CURRENT report
 *     (`amplitude-setup-report.md`) is intentionally NOT gitignored —
 *     many users want to commit it as part of their analytics docs. Only
 *     the archived prior copy is a wizard implementation detail. (PR 316.)
 *   - `.claude/skills/integration-...` — single-use SDK-setup workflows;
 *     removed at end of run. (Pattern is `integration-...slash` in gitignore.)
 *   - The instrumentation/taxonomy skills are kept on disk so users can
 *     invoke them later ("Claude, use the chart-dashboard-plan skill"), but
 *     they're still gitignored — committing them would balloon every PR
 *     diff and surprise users who run `git add .` after the wizard.
 */
export const WIZARD_GITIGNORE_PATTERNS: readonly string[] = [
  '.amplitude/dashboard.json',
  // dashboard-plan.json embeds numeric org/project ids and the agent's chart
  // strategy — same machine-local sensitivity as dashboard.json. Gitignored
  // for the same reason (PR 2 of DEFER_DASHBOARD_PLAN.md).
  '.amplitude/dashboard-plan.json',
  '.amplitude-events.json',
  '.amplitude-dashboard.json',
  // Note: amplitude-setup-report.md (the CURRENT report) is intentionally
  // NOT gitignored — many users want to commit it as part of their
  // analytics docs. Only the wizard-managed archive of the PRIOR report
  // is hidden from source control. (PR 316.)
  PREVIOUS_SETUP_REPORT_FILENAME,
  '.claude/skills/integration-*/',
  '.claude/skills/add-analytics-instrumentation/',
  '.claude/skills/amplitude-chart-dashboard-plan/',
  '.claude/skills/amplitude-quickstart-taxonomy-agent/',
  '.claude/skills/discover-analytics-patterns/',
  '.claude/skills/wizard-prompt-supplement/',
];

/** Marker comment identifying the block as wizard-managed. */
const WIZARD_GITIGNORE_HEADER = '# Amplitude wizard';

/**
 * Append the wizard's artifact patterns to `<installDir>/.gitignore`.
 * Idempotent: re-running after the patterns are already present is a no-op.
 * Creates the file if it doesn't exist.
 *
 * Patterns are written in a single contiguous block under a marker comment
 * so future edits / removals can target the block without disturbing the
 * user's other gitignore content. Silent on I/O errors so a gitignore
 * write failure never blocks the wizard run.
 */
export function ensureWizardArtifactsIgnored(installDir: string): void {
  const gitignorePath = path.join(installDir, '.gitignore');
  try {
    let existing = '';
    if (fs.existsSync(gitignorePath)) {
      existing = fs.readFileSync(gitignorePath, 'utf8');
    }

    // Already covered? Match by checking every pattern is present as a
    // standalone line. Cheap to re-check on every run.
    const lines = existing.split('\n').map((l) => l.trim());
    const missing = WIZARD_GITIGNORE_PATTERNS.filter((p) => !lines.includes(p));
    if (missing.length === 0) return;

    const block = [WIZARD_GITIGNORE_HEADER, ...WIZARD_GITIGNORE_PATTERNS].join(
      '\n',
    );

    // If the marker is already present, replace the block in place rather
    // than appending a second one. This handles the case where someone added
    // a new pattern to WIZARD_GITIGNORE_PATTERNS in a later wizard version.
    //
    // The trailing `(?:\n[^\n]+)*` matches consecutive non-empty lines after
    // the marker — `[^\n]+` (one or more) instead of `[^\n]*` (zero or more)
    // is critical: the latter matches empty content between two `\n`s and
    // greedily consumes blank lines, which would silently swallow any user
    // content below the wizard block.
    if (existing.includes(WIZARD_GITIGNORE_HEADER)) {
      const updated = existing.replace(
        new RegExp(
          `${escapeRegex(WIZARD_GITIGNORE_HEADER)}(?:\\n[^\\n]+)*`,
          'm',
        ),
        block,
      );
      fs.writeFileSync(gitignorePath, updated, 'utf8');
      return;
    }

    // No marker yet — append a fresh block, separated by a blank line if
    // the file is non-empty.
    const separator =
      existing.length === 0 || existing.endsWith('\n\n')
        ? ''
        : existing.endsWith('\n')
        ? '\n'
        : '\n\n';
    fs.writeFileSync(
      gitignorePath,
      `${existing}${separator}${block}\n`,
      'utf8',
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToFile(`ensureWizardArtifactsIgnored: ${msg}`);
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Archive `<installDir>/amplitude-setup-report.md` to a single sibling
 * `amplitude-setup-report.previous.md` if present.
 *
 * Called at the START of a wizard run so the outro screen never advertises
 * a stale report from a previous run (e.g. against a different workspace,
 * or before the user re-authenticated) as if it described THIS run. The
 * fresh report still lands at the canonical `amplitude-setup-report.md`
 * path so existing tooling, CI, and gitignore rules don't need to change.
 *
 * UX choice: we keep exactly ONE prior report, not a timestamped history.
 * Most users want "the latest report" and at most "the one before that"
 * for comparison after a workspace switch. A growing pile of timestamped
 * files (`amplitude-setup-report.2026-04-27T09-16-23.md`, ...) clutters
 * the project root after a handful of runs and adds zero value over the
 * previous-only approach for the typical workflow. If anyone needs a
 * deeper audit trail, git history or CI logs are the right place — not
 * the project root.
 *
 * Silent on I/O errors so a failed archive never blocks the wizard run.
 */
export function archiveSetupReportFile(installDir: string): void {
  const target = path.join(installDir, 'amplitude-setup-report.md');
  const archivePath = path.join(installDir, PREVIOUS_SETUP_REPORT_FILENAME);
  try {
    if (!fs.existsSync(target)) return;
    // rename atomically replaces an existing destination on POSIX, so a
    // run-N+2 cleanly overwrites whatever previous.md held from run-N+1.
    // Each run preserves the immediately-prior report; older ones roll off.
    fs.renameSync(target, archivePath);
    logToFile(`archiveSetupReportFile: ${target} → ${archivePath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToFile(`archiveSetupReportFile: ${msg}`);
  }
}

/**
 * Inverse of {@link archiveSetupReportFile}. Restores
 * `amplitude-setup-report.previous.md` back to `amplitude-setup-report.md`
 * if and only if the canonical path is currently absent.
 *
 * This protects against data loss on cancel / error paths: the wizard
 * archives the prior report at run start, but if the run never reaches
 * the conclude phase (Ctrl+C, agent crash, network error, etc.) nothing
 * writes a fresh canonical report. Without this restore, the user is
 * left with NO report at the canonical path — only the archive — which
 * is functionally the same as deleting their previous report.
 *
 * Silent on I/O errors so a failed restore never blocks teardown.
 */
export function restoreSetupReportIfMissing(installDir: string): void {
  const target = path.join(installDir, 'amplitude-setup-report.md');
  const archivePath = path.join(installDir, PREVIOUS_SETUP_REPORT_FILENAME);
  try {
    // Only restore when the canonical slot is empty — never overwrite a
    // fresh report that the agent did manage to write before failure.
    if (fs.existsSync(target)) return;
    if (!fs.existsSync(archivePath)) return;
    fs.renameSync(archivePath, target);
    logToFile(`restoreSetupReportIfMissing: ${archivePath} → ${target}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToFile(`restoreSetupReportIfMissing: ${msg}`);
  }
}

/**
 * Run wizard-artifact cleanup.
 *
 * Currently composes a single step:
 *   - cleanupIntegrationSkills (remove `.claude/skills/integration-*`,
 *     onSuccess only — preserves them on cancel/error so a re-run
 *     doesn't re-download the skill)
 *
 * Notes on what's intentionally PRESERVED on every exit (success, cancel,
 * error):
 *   - `<installDir>/.amplitude/events.json`, `project-binding.json`, and
 *     `dashboard.json` — canonical project metadata. `events.json` is the
 *     authoritative record of the user's confirmed event plan and is reused
 *     across runs for re-instrumentation. `dashboard.json` is gitignored via
 *     `.amplitude/dashboard.json` so machine-local URLs do not pollute commits;
 *     other `.amplitude/*` files may be committed when teams want.
 *   - Legacy `<installDir>/.amplitude-events.json` and
 *     `.amplitude-dashboard.json` when they already exist — the wizard no
 *     longer writes these paths but does not delete them; readers prefer
 *     `.amplitude/` and fall back to legacy for migration.
 *   - `<installDir>/amplitude-setup-report.md` — user-facing summary the
 *     OutroScreen points at. Kept on disk so the user can read it after
 *     exit; the next run overwrites it.
 *   - Instrumentation and taxonomy skills (everything in
 *     `.claude/skills/` that isn't `integration-*`) — users invoke
 *     these later for event discovery and dashboard planning.
 *     `ensureWizardArtifactsIgnored` keeps them out of git.
 *
 * Silent on errors. Safe to call from any exit path; idempotent.
 */
export function cleanupWizardArtifacts(
  installDir: string,
  options: { onSuccess?: boolean } = {},
): void {
  // Integration skills are single-use SDK-setup workflows — only delete
  // them after a successful run, so the user can re-run cleanly without
  // re-downloading the skill on cancel/error.
  if (options.onSuccess) {
    cleanupIntegrationSkills(installDir);
  }
}

/**
 * Remove wizard-installed integration skills from `<installDir>/.claude/skills/`.
 *
 * Integration skills are a single-use SDK-setup workflow — they're dead
 * weight once the run completes. Instrumentation and taxonomy skills stay
 * on disk because users can invoke them later for event discovery, chart
 * building, and dashboard planning.
 *
 * Only directories whose name starts with `integration-` are removed; other
 * content under `.claude/skills/` (user-owned skills, instrumentation-*,
 * taxonomy-*) is left alone. Silent on I/O errors so a cleanup failure
 * never blocks the success path.
 */
export function cleanupIntegrationSkills(installDir: string): void {
  const skillsDir = path.join(installDir, '.claude', 'skills');
  if (!fs.existsSync(skillsDir)) return;

  try {
    for (const name of fs.readdirSync(skillsDir)) {
      if (!name.startsWith('integration-')) continue;
      const target = path.join(skillsDir, name);
      try {
        fs.rmSync(target, { recursive: true, force: true });
        logToFile(`cleanupIntegrationSkills: removed ${target}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logToFile(
          `cleanupIntegrationSkills: failed to remove ${target}: ${msg}`,
        );
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToFile(`cleanupIntegrationSkills: error scanning ${skillsDir}: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// SDK dynamic import (ESM module loaded once, cached)
// ---------------------------------------------------------------------------

interface ClaudeAgentSDK {
  tool: (...args: unknown[]) => unknown;
  createSdkMcpServer: (config: {
    name: string;
    version: string;
    tools: unknown[];
  }) => unknown;
}

let _sdkModule: ClaudeAgentSDK | null = null;
async function getSDKModule(): Promise<ClaudeAgentSDK> {
  if (!_sdkModule) {
    _sdkModule = (await import(
      '@anthropic-ai/claude-agent-sdk'
    )) as unknown as ClaudeAgentSDK;
  }
  return _sdkModule;
}

// ---------------------------------------------------------------------------
// Options for creating the wizard tools server
// ---------------------------------------------------------------------------

export interface WizardToolsOptions {
  /** Root directory of the project being analyzed */
  workingDirectory: string;

  /** Framework-specific package manager detector */
  detectPackageManager: PackageManagerDetector;

  /**
   * Remote skills server URL (e.g. GitHub Releases base URL).
   * When set, skills are fetched from this URL instead of bundled files.
   * Set via SKILLS_URL env var or pass directly.
   * Example: https://github.com/amplitude/context-hub/releases/latest/download
   */
  skillsBaseUrl?: string;

  /**
   * Returns the StatusReporter for the current agent run. A getter (rather
   * than a direct reference) is used so `createWizardToolsServer` can be
   * called once at process start while the reporter rotates per run/attempt.
   */
  statusReporter?: () => StatusReporter | undefined;
}

/** Structured status / error events emitted by the agent. */
export type StatusKind = 'status' | 'error';

export interface StatusReport {
  kind: StatusKind;
  /**
   * Machine-readable code. For errors, one of the known AgentErrorType values
   * (MCP_MISSING, RESOURCE_MISSING, API_ERROR, RATE_LIMIT, AUTH_ERROR). For
   * status updates, a short identifier like 'skill-loaded' or 'events-drafted'.
   */
  code: string;
  /** Short human-readable detail to surface in the spinner / error outro. */
  detail: string;
}

/** Implemented by the caller (agent-interface) to route status events. */
export interface StatusReporter {
  onStatus(report: StatusReport): void;
  onError(report: StatusReport): void;
}

// ---------------------------------------------------------------------------
// Env file helpers
// ---------------------------------------------------------------------------

/**
 * Resolve filePath relative to workingDirectory, rejecting path traversal.
 */
export function resolveEnvPath(
  workingDirectory: string,
  filePath: string,
): string {
  const resolved = path.resolve(workingDirectory, filePath);
  if (
    !resolved.startsWith(workingDirectory + path.sep) &&
    resolved !== workingDirectory
  ) {
    throw new Error(
      `Path traversal rejected: "${filePath}" resolves outside working directory`,
    );
  }
  return resolved;
}

/**
 * Env file basenames that are often **committed** as shared defaults (Vite,
 * CRA, monorepos). Auto-appending them to `.gitignore` after `set_env_values`
 * breaks those workflows and encourages putting API keys in tracked files.
 * Browser Amplitude keys should live in `*.local` siblings instead.
 */
export const SHARED_COMMITTED_ENV_BASENAMES: ReadonlySet<string> = new Set([
  '.env',
  '.env.development',
  '.env.production',
  '.env.test',
  '.env.staging',
  '.env.defaults',
  '.env.example',
]);

export function shouldSkipAutoGitignoreForEnvBasename(
  envBasename: string,
): boolean {
  return SHARED_COMMITTED_ENV_BASENAMES.has(envBasename);
}

/**
 * Ensure the given env file basename is covered by .gitignore in the working directory.
 * Creates .gitignore if it doesn't exist; appends the entry if missing.
 *
 * Skips shared template names (see {@link SHARED_COMMITTED_ENV_BASENAMES}) so
 * we never gitignore files many repos intentionally track.
 */
export function ensureGitignoreCoverage(
  workingDirectory: string,
  envFileName: string,
): void {
  if (shouldSkipAutoGitignoreForEnvBasename(envFileName)) {
    return;
  }

  const gitignorePath = path.join(workingDirectory, '.gitignore');

  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    // Check if the file (or a glob covering it) is already listed
    if (content.split('\n').some((line) => line.trim() === envFileName)) {
      return;
    }
    const newContent = content.endsWith('\n')
      ? `${content}${envFileName}\n`
      : `${content}\n${envFileName}\n`;
    fs.writeFileSync(gitignorePath, newContent, 'utf8');
  } else {
    fs.writeFileSync(gitignorePath, `${envFileName}\n`, 'utf8');
  }
}

/**
 * Parse a .env file's content and return the set of defined key names.
 */
export function parseEnvKeys(content: string): Set<string> {
  const keys = new Set<string>();
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) {
      keys.add(match[1]);
    }
  }
  return keys;
}

/**
 * Merge key-value pairs into existing .env content.
 * Updates existing keys in-place, appends new keys at the end.
 */
export function mergeEnvValues(
  content: string,
  values: Record<string, string>,
): string {
  let result = content;
  const updatedKeys = new Set<string>();

  for (const [key, value] of Object.entries(values)) {
    const regex = new RegExp(`^(\\s*${key}\\s*=).*$`, 'm');
    if (regex.test(result)) {
      result = result.replace(regex, `$1${value}`);
      updatedKeys.add(key);
    }
  }

  const newKeys = Object.entries(values).filter(
    ([key]) => !updatedKeys.has(key),
  );
  if (newKeys.length > 0) {
    if (result.length > 0 && !result.endsWith('\n')) {
      result += '\n';
    }
    for (const [key, value] of newKeys) {
      result += `${key}=${value}\n`;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Event-name normalization
// ---------------------------------------------------------------------------

/**
 * Normalize an event name to the canonical Title Case shape mandated by
 * the wizard commandments ("[Noun] [Past-Tense Verb]", 2–5 words, ≤50
 * chars).
 *
 * The system prompt asks the model for Title Case, but the
 * `confirm_event_plan` tool schema historically said "lowercase". When
 * the agent saw both, it sometimes emitted snake_case or all-lowercase
 * names, which then rendered as ugly bullets in the Event Plan viewer
 * and broke chart legends downstream. Rather than reject and force a
 * second prompt round-trip, normalize forgivingly here so the contract
 * is always met regardless of which guidance the model believed.
 *
 * Soft normalization — never throws, never rejects. Returns the name
 * unchanged if it's already correctly shaped; converts snake_case,
 * kebab-case, camelCase, and ALL-LOWERCASE inputs into Title Case.
 *
 * Exported for unit testing.
 */
export function normalizeEventName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  // Convert separators (underscore, hyphen, dot) to spaces.
  let working = trimmed.replace(/[_\-.]+/g, ' ');
  // Split camelCase / PascalCase boundaries: insert a space before any
  // uppercase letter that follows a lowercase letter or digit. ASCII-only
  // — event names are English by convention; non-ASCII is left alone so
  // we don't munge intentional UTF-8 in pathological cases.
  working = working.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  // Collapse runs of whitespace.
  working = working.replace(/\s+/g, ' ').trim();
  if (!working) return trimmed;
  // Title-case each word. Preserve fully-uppercase tokens of length ≤4
  // (acronyms like "API", "URL", "SDK"); otherwise capitalize first
  // letter and lowercase the rest.
  const titled = working
    .split(' ')
    .map((word) => {
      if (!word) return word;
      if (word.length <= 4 && /^[A-Z]+$/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
  // Cap at 50 chars to match the wizard's truncation rule.
  return titled.length > 50 ? titled.slice(0, 45) + '…' : titled;
}

// ---------------------------------------------------------------------------
// Event plan persistence
// ---------------------------------------------------------------------------

/**
 * Write the canonical event plan to `<workingDirectory>/.amplitude/events.json`
 * using the shape the wizard UI expects: `[{name, description}]`.
 *
 * Does not write the legacy root `.amplitude-events.json` — readers use
 * {@link readLocalEventPlan} which prefers the canonical file and still
 * honors a pre-existing legacy dotfile from older runs.
 *
 * The agent is instructed (via commandments + integration skills) not to
 * write the canonical file itself — the wizard tool is the single writer so
 * the shape cannot drift. Exported for testing.
 *
 * The `.amplitude/` directory is created lazily on first write and is
 * gitignored as a single line.
 *
 * Returns true on success, false on any filesystem error (the caller logs
 * but doesn't fail the tool call over persistence issues).
 *
 * Accepts the canonical `{name, description}` shape and also the richer
 * `{name, description, callsites?: [{filePath, anchor?}]}` shape introduced
 * by SCALE_RESEARCH §C.1 for the paginated write phase. The richer shape
 * persists the planned call-site so the agent can re-read it and resume
 * after a context compaction without re-deriving placement from scratch.
 * Optional fields are dropped from the on-disk JSON when absent so the
 * file stays scannable for small projects.
 */
export interface PersistableEvent {
  name: string;
  description: string;
  /**
   * Optional planned call-sites for this event. Each entry pairs an absolute
   * or repo-relative `filePath` with a short `anchor` (function/handler name)
   * the agent can grep for if the line shifts. Used by paginated write phase
   * (>50 events) so the rich plan survives compaction. Absent for
   * single-batch runs to keep the file lightweight.
   */
  callsites?: Array<{ filePath: string; anchor?: string }>;
}

export function persistEventPlan(
  workingDirectory: string,
  events: ReadonlyArray<PersistableEvent>,
): boolean {
  try {
    // Refuse to materialize an event plan in a directory the wizard wasn't
    // pointed at. Without this guard, `getProjectMetaDir` + recursive mkdir
    // would happily synthesize the parents — turning a typo or missing
    // installDir into silent file creation in unexpected places.
    if (!fs.existsSync(workingDirectory)) {
      logToFile(
        `persistEventPlan: working directory does not exist: ${workingDirectory}`,
      );
      return false;
    }
    ensureDir(getProjectMetaDir(workingDirectory), 0o755);
    // Strip empty/undefined callsites so the on-disk JSON stays minimal for
    // small projects (the field is purely additive — readers that don't
    // know about it ignore it). Callsites are kept as-emitted otherwise.
    const normalized = events.map((e) => {
      const out: PersistableEvent = {
        name: e.name,
        description: e.description,
      };
      if (e.callsites && e.callsites.length > 0) {
        out.callsites = e.callsites.map((c) => ({
          filePath: c.filePath,
          ...(c.anchor !== undefined ? { anchor: c.anchor } : {}),
        }));
      }
      return out;
    });
    atomicWriteJSON(getEventsFile(workingDirectory), normalized);
    return true;
  } catch (err) {
    logToFile(
      `persistEventPlan: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/**
 * Write a DRAFT event plan to `<workingDirectory>/.amplitude/events.json`.
 *
 * Used as the outro safety net when a wizard run ends with an unresolved
 * `confirm_event_plan` feedback decision (the agent gave the user a plan,
 * the user asked for changes, the agent never circled back to call the
 * tool again with a revised plan). Without this, `events.json` is never
 * written, the user sees "No event plan was persisted" in the outro, and
 * loses the proposed plan AND the feedback they typed.
 *
 * Draft persist writes a wrapper object — `{ events, draft, lastFeedback }`
 * — instead of the plain array shape `persistEventPlan` uses. The
 * canonical reader (`parseEventPlanContent` in event-plan-parser.ts)
 * already tolerates `{ events: [...] }` wrappers, so existing callers
 * continue to render the events correctly while ignoring the extra
 * `draft` / `lastFeedback` fields. New code can opt in by reading the
 * raw JSON and surfacing the draft state to the user (see the outro
 * fallback report).
 *
 * Refuses to overwrite a non-draft `events.json` — that would clobber
 * a prior approved plan. The check is best-effort: if the existing
 * file can't be parsed, we treat it as not-a-finalized-plan and write
 * the draft anyway. Returns true on a successful write, false on any
 * filesystem or guard failure.
 */
export function persistDraftEventPlan(
  workingDirectory: string,
  events: Array<{ name: string; description: string }>,
  lastFeedback: string,
): boolean {
  try {
    if (!fs.existsSync(workingDirectory)) {
      logToFile(
        `persistDraftEventPlan: working directory does not exist: ${workingDirectory}`,
      );
      return false;
    }

    const eventsFile = getEventsFile(workingDirectory);

    // Don't clobber an approved plan. If the file already exists and is
    // a plain array OR a wrapper without `draft: true`, leave it alone —
    // the user's previous run may have left a valid plan on disk that
    // this run failed to advance past. Re-running the wizard is the
    // correct recovery path; silently overwriting would lose data.
    if (fs.existsSync(eventsFile)) {
      try {
        const raw = fs.readFileSync(eventsFile, 'utf8');
        const parsed: unknown = JSON.parse(raw);
        const isDraft =
          parsed &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed) &&
          (parsed as { draft?: unknown }).draft === true;
        if (!isDraft) {
          logToFile(
            `persistDraftEventPlan: refusing to overwrite non-draft ${eventsFile}`,
          );
          return false;
        }
      } catch (err) {
        // Unparseable existing file — most likely a partial write or
        // corruption. Better to overwrite with a usable draft than to
        // leave the user stuck.
        logToFile(
          `persistDraftEventPlan: existing ${eventsFile} unparseable, overwriting (${
            err instanceof Error ? err.message : String(err)
          })`,
        );
      }
    }

    ensureDir(getProjectMetaDir(workingDirectory), 0o755);
    atomicWriteJSON(eventsFile, {
      events: events.map((e) => ({
        name: e.name,
        description: e.description,
      })),
      draft: true,
      lastFeedback,
    });
    logToFile(
      `persistDraftEventPlan: wrote draft with ${events.length} event(s) and feedback="${lastFeedback}"`,
    );
    return true;
  } catch (err) {
    logToFile(
      `persistDraftEventPlan: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return false;
  }
}

/**
 * Write the dashboard payload to the canonical
 * `<workingDirectory>/.amplitude/dashboard.json`.
 *
 * Called from the dashboard file-watcher in `agent-interface.ts` whenever a
 * valid dashboard file is detected. Idempotent and silent on errors.
 */
export function persistDashboard(
  workingDirectory: string,
  content: Record<string, unknown>,
): boolean {
  try {
    if (!fs.existsSync(workingDirectory)) {
      logToFile(
        `persistDashboard: working directory does not exist: ${workingDirectory}`,
      );
      return false;
    }
    ensureDir(getProjectMetaDir(workingDirectory), 0o755);
    atomicWriteJSON(getDashboardFile(workingDirectory), content);
    return true;
  } catch (err) {
    logToFile(
      `persistDashboard: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Setup-report fallback writer
// ---------------------------------------------------------------------------

/**
 * Information the fallback writer needs to produce a minimal report.
 * All fields are optional — the writer degrades gracefully when something
 * isn't available (e.g. the dashboard step never ran, the events file was
 * never persisted, the framework wasn't detected).
 */
export interface FallbackReportContext {
  /** Project root where the report file lands. Required. */
  installDir: string;
  /** Detected integration name (e.g. "nextjs", "vue"). */
  integration?: string | null;
  /** Dashboard URL returned by the Amplitude MCP. */
  dashboardUrl?: string | null;
  /** Workspace / project name shown in Amplitude UI. */
  workspaceName?: string | null;
  /** Environment name (e.g. "production", "development"). */
  envName?: string | null;
}

/**
 * Read the persisted event plan (canonical `.amplitude/events.json`, then
 * legacy `.amplitude-events.json` by mtime). Returns an empty array on any
 * failure — the fallback writer is best-effort.
 */
function readPersistedEventPlan(
  installDir: string,
): Array<{ name: string; description: string }> {
  return readLocalEventPlan(installDir);
}

/**
 * Inspect the canonical `<installDir>/.amplitude/events.json` for the
 * draft-marker shape that {@link persistDraftEventPlan} writes when a
 * run ends with unresolved `confirm_event_plan` feedback. Returns
 * `null` for the common case (file missing, or contents are a regular
 * approved plan) so callers can short-circuit. Best-effort and silent
 * on parse errors.
 */
export function readDraftEventPlanMeta(
  installDir: string,
): { lastFeedback: string } | null {
  const eventsFile = getEventsFile(installDir);
  if (!fs.existsSync(eventsFile)) return null;
  try {
    const raw = fs.readFileSync(eventsFile, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      (parsed as { draft?: unknown }).draft === true
    ) {
      const fb = (parsed as { lastFeedback?: unknown }).lastFeedback;
      return { lastFeedback: typeof fb === 'string' ? fb : '' };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Render a minimal Markdown setup report from session state. Exported so
 * tests can lock down the formatting without going through the filesystem.
 */
export function buildFallbackReport(ctx: FallbackReportContext): string {
  const events = readPersistedEventPlan(ctx.installDir);
  const draftMeta = readDraftEventPlanMeta(ctx.installDir);
  const lines: string[] = [];

  lines.push('<wizard-report>');
  lines.push('# Amplitude post-wizard report');
  lines.push('');
  lines.push(
    "_This report was generated automatically by the Amplitude wizard. The agent didn't produce one this run, so the wizard wrote a minimal recap from what it knows._",
  );
  lines.push('');

  lines.push('## Integration summary');
  lines.push('');
  const summaryStart = lines.length;
  if (ctx.integration) lines.push(`- **Framework**: ${ctx.integration}`);
  if (ctx.workspaceName) lines.push(`- **Project**: ${ctx.workspaceName}`);
  if (ctx.envName) lines.push(`- **Environment**: ${ctx.envName}`);
  if (lines.length === summaryStart) {
    lines.push('- _Detected framework not available._');
  }
  lines.push('');

  if (events.length > 0) {
    lines.push('## Instrumented events');
    lines.push('');
    if (draftMeta) {
      // The events file we just read is a DRAFT — the agent proposed a
      // plan, the user gave feedback, and the agent never closed the
      // loop. Surface that state explicitly so the user knows the table
      // below is the LAST proposal (not what's actually in the code) and
      // gets pointed back into the wizard to keep iterating.
      lines.push(
        `_Feedback was given but the plan was never finalized — re-run the wizard to continue iterating. Your feedback was: "${draftMeta.lastFeedback}"._`,
      );
      lines.push('');
    }
    lines.push('| Event | Description |');
    lines.push('| --- | --- |');
    for (const e of events) {
      const name = e.name.replace(/\|/g, '\\|');
      const desc = (e.description || '').replace(/\|/g, '\\|');
      lines.push(`| \`${name}\` | ${desc} |`);
    }
    lines.push('');
  } else {
    lines.push('## Instrumented events');
    lines.push('');
    lines.push(
      '_No event plan was persisted. If this is unexpected, re-run the wizard or check `.amplitude/events.json` (or legacy `.amplitude-events.json`) in your project._',
    );
    lines.push('');
  }

  lines.push('## Analytics dashboard');
  lines.push('');
  if (ctx.dashboardUrl) {
    lines.push(
      `Open your dashboard: ${toWizardDashboardOpenUrl(ctx.dashboardUrl)}`,
    );
  } else {
    lines.push(
      "_The wizard didn't capture a dashboard URL. You can build one from your events at https://app.amplitude.com._",
    );
  }
  lines.push('');

  lines.push('## Next steps');
  lines.push('');
  lines.push(
    '- Trigger the instrumented user flows in your app and confirm events appear in Amplitude.',
  );
  lines.push(
    '- Set the Amplitude API key in your production environment (deploy platform settings or CI secrets).',
  );
  lines.push(
    '- Re-run `npx @amplitude/wizard` if you want a richer end-of-run report — the agent writes a more detailed version when it reaches the conclude phase.',
  );
  lines.push('');
  lines.push('</wizard-report>');
  lines.push('');

  return lines.join('\n');
}

/**
 * Write `<installDir>/amplitude-setup-report.md` when the canonical
 * path is empty. Safety net for runs where the agent skipped the
 * conclude-phase report (model variance, ran out of turns, mid-run
 * cancel before conclude, etc.).
 *
 * The companion `archiveSetupReportFile()` (run at the start of every
 * run, in PR #316) moves any prior report to
 * `amplitude-setup-report.previous.md`, so the canonical path is
 * guaranteed to either be empty or freshly written by the current run
 * when this function is called. There's no need for mtime / staleness
 * logic — `existsSync` is authoritative.
 *
 * Returns:
 *   - 'agent-wrote'    — agent wrote a fresh report this run; left untouched.
 *   - 'fallback-wrote' — canonical was missing; wrote a stub.
 *   - 'failed'         — write threw (permissions, disk full, etc.).
 *
 * Silent on errors; never throws — the wizard's outcome must not be
 * blocked by a failed report write.
 */
export function writeFallbackReportIfMissing(
  ctx: FallbackReportContext,
): 'agent-wrote' | 'fallback-wrote' | 'failed' {
  const reportPath = path.join(ctx.installDir, 'amplitude-setup-report.md');
  try {
    if (fs.existsSync(reportPath)) {
      logToFile(
        `writeFallbackReportIfMissing: agent already wrote ${reportPath}`,
      );
      return 'agent-wrote';
    }

    const content = buildFallbackReport(ctx);
    fs.writeFileSync(reportPath, content, 'utf8');
    logToFile(
      `writeFallbackReportIfMissing: wrote stub report to ${reportPath}`,
    );
    return 'fallback-wrote';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToFile(`writeFallbackReportIfMissing: ${msg}`);
    return 'failed';
  }
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

const SERVER_NAME = 'wizard-tools';

/**
 * Description appended to every tool's `reason` parameter. Kept as a constant
 * so all wizard-tools schemas describe `reason` identically — the agent reads
 * the description verbatim to decide what to write here.
 */
const REASON_FIELD_DESCRIPTION =
  'A short sentence (≤25 words) explaining WHY you are invoking this tool right now — what you are trying to accomplish at this step. Captured in Agent Analytics so the team can understand intent across runs.';

/**
 * Reusable Zod field for the `reason` parameter required on every wizard tool.
 * Adding `.min(1)` so an empty string is rejected — analytics needs real text.
 */
const reasonField = z.string().min(1).describe(REASON_FIELD_DESCRIPTION);

/**
 * Create the unified in-process MCP server with all wizard tools.
 * Must be called asynchronously because the SDK is an ESM module loaded via dynamic import.
 */
export async function createWizardToolsServer(options: WizardToolsOptions) {
  const {
    workingDirectory,
    detectPackageManager,
    skillsBaseUrl,
    statusReporter,
  } = options;
  const { tool, createSdkMcpServer } = await getSDKModule();

  // Skill menu loading (cachedSkillMenu / categoryNames) intentionally
  // skipped — the load_skill_menu / install_skill tools that consumed
  // it are disabled (see the disabled-tool block further down). When
  // those tools are re-enabled, restore the menu loading too:
  //
  //   const menu = skillsBaseUrl
  //     ? (await fetchSkillMenu(skillsBaseUrl)) ?? loadBundledSkillMenu()
  //     : loadBundledSkillMenu();
  //   const cachedSkillMenu: Record<string, SkillEntry[]> = menu?.categories ?? {};
  //   const keys = Object.keys(cachedSkillMenu);
  //   const categoryNames: [string, ...string[]] =
  //     keys.length > 0 ? (keys as [string, ...string[]]) : ['integration'];
  //
  // `skillsBaseUrl` is still threaded through this factory's signature
  // so re-enabling doesn't require changing the public API.
  void skillsBaseUrl;

  // -- check_env_keys -------------------------------------------------------

  const checkEnvKeys = tool(
    'check_env_keys',
    'Check which environment variable keys are present or missing in a .env file. Never reveals values.',
    {
      filePath: z
        .string()
        .describe('Path to the .env file, relative to the project root'),
      keys: z
        .array(z.string())
        .describe('Environment variable key names to check'),
      reason: reasonField,
    },
    (args: { filePath: string; keys: string[]; reason: string }) => {
      let resolved: string;
      try {
        resolved = resolveEnvPath(workingDirectory, args.filePath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logToFile(`check_env_keys: path rejected: ${msg}`);
        return toWizardToolErrorContent({
          error: `path rejected: ${msg}`,
          guidance: `Pass a path RELATIVE to the project root (e.g. ".env.local"), not an absolute path or one with "..". Try filePath: ".env.local" or ".env" instead.`,
          suggestedTool: 'mcp__wizard-tools__check_env_keys',
          context: `installDir: ${workingDirectory}; rejected filePath: ${args.filePath}`,
        });
      }
      logToFile(`check_env_keys: ${resolved}, keys: ${args.keys.join(', ')}`);

      if (args.keys.length === 0) {
        return toWizardToolErrorContent({
          error: 'no keys requested',
          guidance:
            'Pass at least one env-var name in `keys`. If you do not yet know which keys to check, the canonical Amplitude browser key is AMPLITUDE_API_KEY (server) or NEXT_PUBLIC_AMPLITUDE_API_KEY / VITE_AMPLITUDE_API_KEY (browser, framework-specific).',
          suggestedTool: 'mcp__wizard-tools__check_env_keys',
          context: `filePath: ${args.filePath}`,
        });
      }

      const existingKeys: Set<string> = fs.existsSync(resolved)
        ? parseEnvKeys(fs.readFileSync(resolved, 'utf8'))
        : new Set<string>();

      const results: Record<string, 'present' | 'missing'> = {};
      for (const key of args.keys) {
        results[key] = existingKeys.has(key) ? 'present' : 'missing';
      }

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(results, null, 2) },
        ],
      };
    },
  );

  // -- set_env_values -------------------------------------------------------

  const setEnvValues = tool(
    'set_env_values',
    'Create or update environment variable keys in a .env file. Creates the file if it does not exist. Ensures .gitignore coverage for secret-local files (e.g. .env.local). For Vite and similar stacks, prefer `.env.development.local` / `.env.production.local` when the repo already tracks `.env.development` / `.env.production` — never rely on auto-gitignore for those tracked template names.',
    {
      filePath: z
        .string()
        .describe('Path to the .env file, relative to the project root'),
      values: z
        .record(z.string(), z.string())
        .describe('Key-value pairs to set'),
      reason: reasonField,
    },
    (args: {
      filePath: string;
      values: Record<string, string>;
      reason: string;
    }) => {
      let resolved: string;
      try {
        resolved = resolveEnvPath(workingDirectory, args.filePath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logToFile(`set_env_values: path rejected: ${msg}`);
        return toWizardToolErrorContent({
          error: `path rejected: ${msg}`,
          guidance: `Pass a path RELATIVE to the project root (e.g. ".env.local"), not an absolute path or one with "..". Retry with filePath: ".env.local".`,
          suggestedTool: 'mcp__wizard-tools__set_env_values',
          context: `installDir: ${workingDirectory}; rejected filePath: ${args.filePath}`,
        });
      }
      logToFile(
        `set_env_values: ${resolved}, keys: ${Object.keys(args.values).join(
          ', ',
        )}`,
      );

      if (Object.keys(args.values).length === 0) {
        return toWizardToolErrorContent({
          error: 'no values to set',
          guidance:
            'Pass at least one key/value pair in `values` (e.g. {"AMPLITUDE_API_KEY": "<key>"}). If the key is already correct, skip this call.',
          suggestedTool: 'mcp__wizard-tools__set_env_values',
          context: `filePath: ${args.filePath}`,
        });
      }

      const existing = fs.existsSync(resolved)
        ? fs.readFileSync(resolved, 'utf8')
        : '';
      const content = mergeEnvValues(existing, args.values);

      // Ensure parent directory exists
      const dir = path.dirname(resolved);
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logToFile(`set_env_values: mkdir failed for ${dir}: ${msg}`);
        return toWizardToolErrorContent({
          error: `cannot create parent directory for env file: ${msg}`,
          guidance: `The parent directory of "${args.filePath}" cannot be created. Use a simpler path at the project root (e.g. ".env.local") instead of a nested directory.`,
          suggestedTool: 'mcp__wizard-tools__set_env_values',
          suggestedArgs: { filePath: '.env.local', values: args.values },
          context: `parent dir: ${dir}; installDir: ${workingDirectory}`,
        });
      }

      try {
        fs.writeFileSync(resolved, content, 'utf8');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logToFile(`set_env_values: writeFile failed for ${resolved}: ${msg}`);
        return toWizardToolErrorContent({
          error: `cannot write env file: ${msg}`,
          guidance: `The env file at "${args.filePath}" is not writable. Note this in the setup report and proceed — do NOT retry the same path.`,
          context: `resolved path: ${resolved}; installDir: ${workingDirectory}`,
        });
      }

      // Ensure .gitignore coverage for this env file (skipped for shared
      // committed templates like .env.development — see ensureGitignoreCoverage).
      const envFileName = path.basename(resolved);
      ensureGitignoreCoverage(workingDirectory, envFileName);

      const skipNote = shouldSkipAutoGitignoreForEnvBasename(envFileName)
        ? ' Note: this filename is often a committed env template; use a `.local` sibling for values that must stay untracked.'
        : '';

      return {
        content: [
          {
            type: 'text' as const,
            text: `Updated ${Object.keys(args.values).length} key(s) in ${
              args.filePath
            }.${skipNote}`,
          },
        ],
      };
    },
  );

  // -- detect_package_manager -----------------------------------------------
  //
  // The agent typically calls this 2–3 times during a run (before
  // installing the SDK, before running typecheck, sometimes again before
  // verification). Each call previously paid a fresh disk scan of the
  // working directory and any framework-specific lockfile probes —
  // observably 50–250ms in dev, longer on a slow FS. The package manager
  // can't change mid-run, so memoize the first scan for the lifetime of
  // this tools server (one server per wizard run).
  //
  // The cache is a Promise so concurrent calls share the same in-flight
  // scan instead of racing.
  let detectPMCache: Promise<
    Awaited<ReturnType<typeof detectPackageManager>>
  > | null = null;

  const detectPM = tool(
    'detect_package_manager',
    'Detect which package manager(s) the project uses. Returns the name, install command, and run command for each detected package manager. Call this before running any install commands.',
    {
      reason: reasonField,
    },
    async (_args: { reason: string }) => {
      if (detectPMCache) {
        logToFile(`detect_package_manager: cache hit for ${workingDirectory}`);
      } else {
        logToFile(`detect_package_manager: scanning ${workingDirectory}`);
        detectPMCache = detectPackageManager(workingDirectory).catch((err) => {
          detectPMCache = null;
          throw err;
        });
      }

      let result: Awaited<ReturnType<typeof detectPackageManager>>;
      try {
        result = await detectPMCache;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logToFile(`detect_package_manager: scan failed: ${msg}`);
        return toWizardToolErrorContent({
          error: `package-manager detection failed: ${msg}`,
          guidance: `Ask the user which package manager to use via the \`choose\` tool with options like ["npm", "pnpm", "yarn", "bun"], or skip the SDK install step and document the limitation in the setup report.`,
          suggestedTool: 'mcp__wizard-tools__choose',
          suggestedArgs: {
            message: 'Which package manager does this project use?',
            options: ['npm', 'pnpm', 'yarn', 'bun'],
          },
          context: `workingDirectory: ${workingDirectory}`,
        });
      }

      logToFile(
        `detect_package_manager: detected ${result.detected.length} package manager(s)`,
      );

      if (result.detected.length === 0) {
        return toWizardToolErrorContent({
          error: 'no recognized package manager / lockfile in this project',
          guidance: `Ask the user which package manager to use via the \`choose\` tool, or skip the SDK install step and document the limitation in the setup report. Do NOT call detect_package_manager again — the result is cached.`,
          suggestedTool: 'mcp__wizard-tools__choose',
          suggestedArgs: {
            message: 'Which package manager does this project use?',
            options: ['npm', 'pnpm', 'yarn', 'bun'],
          },
          context: `workingDirectory: ${workingDirectory}; checked for package.json, lockfiles, requirements.txt, etc.`,
        });
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  /**
   * Tier-1 / Tier-2 skill delivery — registers `load_skill_menu`,
   * `load_skill`, and `load_skill_reference` when tiers are enabled
   * (default-on; opt-out via `AMPLITUDE_WIZARD_SKILL_TIERS=0`). See
   * NEW_MIGRATION_PLAN Phase C / SKILLS_AND_CONTEXT_DESIGN.md.
   */
  const tieredSkillTools = isSkillTiersEnabled()
    ? [
        tool(
          'load_skill_menu',
          'Return bundled skill ids + names by category for tiered skill loading. Available by default; opt out with AMPLITUDE_WIZARD_SKILL_TIERS=0.',
          {
            category: z
              .string()
              .optional()
              .describe(
                'Optional category filter (integration, instrumentation, taxonomy, wizard).',
              ),
            reason: reasonField,
          },
          (args: { category?: string; reason: string }) => {
            void args.reason;
            const menu = loadBundledSkillMenu();
            const categories = menu.categories;
            if (args.category) {
              const list = categories[args.category];
              if (!list || list.length === 0) {
                const known = Object.keys(categories);
                return toWizardToolErrorContent({
                  error: `unknown skill category: ${args.category}`,
                  guidance: `Call load_skill_menu with no category to see all available categories, or pick one of: ${known.join(
                    ', ',
                  )}.`,
                  suggestedTool: 'mcp__wizard-tools__load_skill_menu',
                  context: `requested category: ${args.category}`,
                });
              }
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: JSON.stringify(
                      {
                        category: args.category,
                        skills: list.map((s) => ({ id: s.id, name: s.name })),
                      },
                      null,
                      2,
                    ),
                  },
                ],
              };
            }
            const out = Object.fromEntries(
              Object.entries(categories).map(([name, entries]) => [
                name,
                entries.map((s) => ({ id: s.id, name: s.name })),
              ]),
            );
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({ categories: out }, null, 2),
                },
              ],
            };
          },
        ),
        tool(
          'load_skill',
          'Return SKILL.md for a bundled Amplitude skill id (single-step; no load_skill_menu loop). Available by default (opt out with AMPLITUDE_WIZARD_SKILL_TIERS=0). Use ids from the system skill menu / integration resolution only. Do NOT call this repeatedly for the same skillId — bodies are cached for the run.',
          {
            skillId: z
              .string()
              .describe(
                'Bundled skill folder id (e.g. add-analytics-instrumentation)',
              ),
            reason: reasonField,
          },
          (args: { skillId: string; reason: string }) => {
            void args.reason;
            // Single traversal — readBundledSkillBody already walks every
            // category subdir and returns null when missing, so an extra
            // bundledSkillExists() probe just doubles the disk work.
            const body = readBundledSkillBody(args.skillId);
            if (body == null) {
              return toWizardToolErrorContent({
                error: `unknown or missing bundled skill: ${args.skillId}`,
                guidance: `Call load_skill_menu (no category) to list every bundled skill id, then retry load_skill with a valid id. Skills already pre-staged at .claude/skills/ can be invoked via the Skill tool directly without going through this MCP.`,
                suggestedTool: 'mcp__wizard-tools__load_skill_menu',
                context: `requested skillId: ${args.skillId}`,
              });
            }
            logToFile(`load_skill: ${args.skillId} (${body.length} chars)`);
            return {
              content: [{ type: 'text' as const, text: body }],
            };
          },
        ),
        tool(
          'load_skill_reference',
          'Return a bundled skill reference markdown file by relative path. Path must be references/*.md. Available by default (opt out with AMPLITUDE_WIZARD_SKILL_TIERS=0).',
          {
            skillId: z
              .string()
              .describe(
                'Bundled skill folder id (e.g. add-analytics-instrumentation)',
              ),
            refPath: z
              .string()
              .regex(SKILL_REFERENCE_REL_PATH)
              .describe(
                'Relative reference markdown path under the skill (e.g. references/browser-sdk-2.md)',
              ),
            reason: reasonField,
          },
          (args: { skillId: string; refPath: string; reason: string }) => {
            void args.reason;
            if (!bundledSkillExists(args.skillId)) {
              return toWizardToolErrorContent({
                error: `unknown or missing bundled skill: ${args.skillId}`,
                guidance: `Call load_skill_menu (no category) to list every bundled skill id, then retry. Skill ids look like "amplitude-quickstart-taxonomy-agent" — not framework names like "next.js".`,
                suggestedTool: 'mcp__wizard-tools__load_skill_menu',
                context: `requested skillId: ${args.skillId}; refPath: ${args.refPath}`,
              });
            }
            const reference = readBundledSkillReference(
              args.skillId,
              args.refPath,
            );
            if (reference == null) {
              return toWizardToolErrorContent({
                error: `reference not found in skill: ${args.refPath}`,
                guidance: `Load the skill body first via load_skill ({ skillId: "${args.skillId}" }) to see which references it lists. The refPath must match a file under references/ in that skill's bundle.`,
                suggestedTool: 'mcp__wizard-tools__load_skill',
                suggestedArgs: { skillId: args.skillId },
                context: `skillId: ${args.skillId}; refPath: ${args.refPath}`,
              });
            }
            logToFile(
              `load_skill_reference: ${args.skillId}/${args.refPath} (${reference.length} chars)`,
            );
            return {
              content: [{ type: 'text' as const, text: reference }],
            };
          },
        ),
      ]
    : [];

  // -- load_skill_menu / install_skill — DISABLED ───────────────────────────
  //
  // Both tools currently 400 in production: remote skill downloads return
  // not-found errors and the bundled-skill fallback hits packs the agent
  // can't make sense of without the runtime menu. Until the catalogue
  // / download path is fixed, don't expose them to the agent — they
  // confuse it more than they help (the agent loops calling
  // load_skill_menu → install_skill → load_skill_menu) and waste turns.
  //
  // Constant skills (taxonomy + instrumentation + dashboard) are still
  // pre-installed at runtime by `installConstantSkills`, so the agent
  // can `Skill.load` them directly without going through this menu.
  //
  // To re-enable: uncomment the two `tool(...)` blocks below, add them
  // back to the `tools: [...]` array on `createSdkMcpServer`, and add
  // their names back to `WIZARD_TOOL_NAMES`. The original implementations
  // are preserved here so re-enabling is a small diff.
  /*
  const loadSkillMenu = tool(
    'load_skill_menu',
    'Load available Amplitude skills for a category. Returns skill IDs and names. Call this first, then use install_skill with the chosen ID.',
    {
      category: z.enum(categoryNames).describe('Skill category'),
      reason: reasonField,
    },
    (args: { category: string; reason: string }) => {
      const skills = cachedSkillMenu[args.category];
      if (!skills || skills.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No skills found for category "${args.category}".`,
            },
          ],
          isError: true,
        };
      }

      const menuText = skills.map((s) => `- ${s.id}: ${s.name}`).join('\n');

      logToFile(
        `load_skill_menu: returning ${skills.length} skills for "${args.category}"`,
      );

      return {
        content: [{ type: 'text' as const, text: menuText }],
      };
    },
  );

  const installSkill = tool(
    'install_skill',
    'Download and install an Amplitude skill by ID. Call load_skill_menu first to see available skills. Extracts the skill to .claude/skills/<skillId>/.',
    {
      skillId: z
        .string()
        .describe(
          'Skill ID from the skill menu (e.g., "integration-nextjs-app-router")',
        ),
      reason: reasonField,
    },
    (args: { skillId: string; reason: string }) => {
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(args.skillId)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Error: skillId must be lowercase alphanumeric with hyphens.',
            },
          ],
          isError: true,
        };
      }

      const allSkills: SkillEntry[] = Object.values(cachedSkillMenu).flat();
      const skill = allSkills.find((s) => s.id === args.skillId);
      if (!skill) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: skill "${args.skillId}" not found. Use load_skill_menu to see available skills.`,
            },
          ],
          isError: true,
        };
      }

      const result = skill.downloadUrl
        ? downloadSkill(skill, workingDirectory)
        : installBundledSkill(args.skillId, workingDirectory);
      if (result.success) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Skill installed to .claude/skills/${args.skillId}/`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error installing skill: ${result.error}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
  */

  // -- confirm --------------------------------------------------------------

  const confirm = tool(
    'confirm',
    'Ask the user a yes/no question and wait for their answer. Returns true if confirmed, false if declined or skipped.',
    {
      message: z
        .string()
        .describe('The confirmation question to show the user'),
      reason: reasonField,
    },
    async (args: { message: string; reason: string }) => {
      logToFile(`confirm: ${args.message}`);
      const answer = await getUI().promptConfirm(args.message);
      return {
        content: [{ type: 'text' as const, text: answer ? 'true' : 'false' }],
      };
    },
  );

  // -- choose ---------------------------------------------------------------

  const choose = tool(
    'choose',
    'Present the user with a list of options and wait for their selection. Returns the chosen option, or an empty string if skipped.',
    {
      message: z.string().describe('The prompt to show above the options'),
      options: z
        .array(z.string())
        .min(2)
        .describe('The list of choices to present'),
      reason: reasonField,
    },
    async (args: { message: string; options: string[]; reason: string }) => {
      logToFile(`choose: ${args.message}, options: ${args.options.join(', ')}`);
      const answer = await getUI().promptChoice(args.message, args.options);
      return {
        content: [{ type: 'text' as const, text: answer }],
      };
    },
  );

  // -- confirm_event_plan ---------------------------------------------------

  const confirmEventPlan = tool(
    'confirm_event_plan',
    `Present the proposed instrumentation plan to the user for review BEFORE instrumenting any events.
Call this tool AFTER installing the SDK and adding initialization code, but BEFORE writing any track() calls.
The user can approve the plan, skip the review, or give feedback.

You MUST NOT ask the user clarifying questions in response to feedback. Make a reasonable interpretation of their feedback, revise the plan in-process, and call this tool again with the revised events. The user can give more feedback in the next round if your interpretation was wrong — do not block the run with a chat-style follow-up question, the wizard has no surface for the user to reply mid-stream.

If the user gives feedback, revise your plan and call this tool again — loop until approved or skipped.
Returns: "approved", "skipped", or "feedback: <user message>".

For codebases with >50 events the wizard runs the WRITE phase in chunks of ~25 events at a time. You can supply optional batchIndex/totalBatches/chunkSize fields to label the proposed plan as paginated; absent them the wizard treats the events array as a single full plan (existing behavior). Each event may also carry a callsites[] array — when present it's persisted to .amplitude/events.json so the rich plan survives a context compaction.`,
    {
      events: z
        .array(
          z.object({
            name: z
              .string()
              .describe(
                'Title Case event name, [Noun] [Past-Tense Verb], 2-5 words. Examples: "User Signed Up", "Product Added To Cart", "Search Performed", "Checkout Started". NOT snake_case ("user_signed_up"), camelCase ("userSignedUp"), or lowercase ("user signed up"). Do NOT put descriptions or file paths here.',
              ),
            description: z
              .string()
              .describe(
                'One short sentence (≤20 words) stating when this event fires. Do NOT include file paths, property lists, autocapture rationale, or implementation notes — those belong in internal planning, not in the user-facing plan.',
              ),
            callsites: z
              .array(
                z.object({
                  filePath: z
                    .string()
                    .describe(
                      'Repo-relative path to the file where this event will be instrumented (e.g. "src/app/checkout/page.tsx"). Used to keep the rich plan recoverable across context compaction.',
                    ),
                  anchor: z
                    .string()
                    .optional()
                    .describe(
                      'Optional handler/function name the track() call will go inside (e.g. "onSubmit"). Survives line-number drift better than a numeric line.',
                    ),
                }),
              )
              .optional()
              .describe(
                'Optional list of planned call-sites for this event. Persisted to .amplitude/events.json as recovery context for paginated write phases.',
              ),
          }),
        )
        .min(1)
        .describe('The list of events you plan to instrument'),
      decision: z
        .enum(['confirm', 'edit', 'skip'])
        .optional()
        .describe(
          'Optional self-declared intent. Forward-compatible field — the wizard still routes the user-facing prompt through the TUI. "confirm" = ask the user to approve, "edit" = the agent has revised an earlier plan, "skip" = the agent wants to skip the review (the user still has final say).',
        ),
      batchIndex: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          '0-indexed batch number when the plan is paginated. Must be < totalBatches. Absent for single-batch plans (legacy shape).',
        ),
      totalBatches: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          'Total number of batches in the paginated plan. Absent for single-batch plans (legacy shape).',
        ),
      chunkSize: z
        .number()
        .int()
        .min(5)
        .optional()
        .describe(
          'Events per batch (declared by the agent for transparency). Default 25; configurable via AMPLITUDE_WIZARD_EVENT_PLAN_CHUNK_SIZE. The runner is the source of truth for chunking — this field is informational.',
        ),
      reason: reasonField,
    },
    async (args: {
      events: Array<{
        name: string;
        description: string;
        callsites?: Array<{ filePath: string; anchor?: string }>;
      }>;
      decision?: 'confirm' | 'edit' | 'skip';
      batchIndex?: number;
      totalBatches?: number;
      chunkSize?: number;
      reason: string;
    }) => {
      const { DEMO_MODE } = await import('./constants.js');
      // Validate optional batch metadata before any other work. We reject
      // structurally-invalid combinations (batchIndex without totalBatches,
      // batchIndex >= totalBatches, etc.) at the tool boundary so a typo in
      // the agent's call doesn't silently produce a malformed plan on disk.
      // Pure helper — see src/lib/event-plan-pagination.ts.
      const { validateBatchMetadata } = await import(
        './event-plan-pagination.js'
      );
      const batchError = validateBatchMetadata({
        batchIndex: args.batchIndex,
        totalBatches: args.totalBatches,
        chunkSize: args.chunkSize,
        eventCount: args.events.length,
      });
      if (batchError) {
        logToFile(`confirm_event_plan: rejected batch metadata: ${batchError}`);
        return toWizardToolErrorContent({
          error: `invalid batch metadata — ${batchError}`,
          guidance:
            'Re-call without batch fields (batchIndex / totalBatches / chunkSize) to fall back to single-batch behavior, or fix the metadata and retry. batchIndex must be < totalBatches; both must be present together; chunkSize must be a positive integer when supplied.',
          suggestedTool: 'mcp__wizard-tools__confirm_event_plan',
          context: `batchIndex: ${String(
            args.batchIndex,
          )}; totalBatches: ${String(args.totalBatches)}; chunkSize: ${String(
            args.chunkSize,
          )}; eventCount: ${args.events.length}`,
        });
      }
      // Soft-gate the name format. Agents historically saw conflicting
      // guidance (commandments said Title Case, the tool schema said
      // lowercase) and emitted mixed shapes. Normalize forgivingly here
      // so the persisted plan AND the user-facing prompt always match
      // the canonical Title Case shape — no second prompt round-trip
      // needed when the model gets it slightly wrong.
      let normalizationCount = 0;
      const normalizedEvents = args.events.map((e) => {
        const original = e.name.trim();
        const normalized = normalizeEventName(original);
        if (normalized !== original) normalizationCount += 1;
        // Preserve callsites verbatim — they're additive, used by the
        // paginated write phase for compaction-recovery context. We trim
        // filePath for safety but otherwise don't shape them here.
        const callsites = e.callsites
          ?.filter((c) => c.filePath && c.filePath.trim().length > 0)
          .map((c) => ({
            filePath: c.filePath.trim(),
            ...(c.anchor && c.anchor.trim().length > 0
              ? { anchor: c.anchor.trim() }
              : {}),
          }));
        return {
          name: normalized,
          description: e.description?.trim() || '',
          ...(callsites && callsites.length > 0 ? { callsites } : {}),
        };
      });
      if (normalizationCount > 0) {
        logToFile(
          `confirm_event_plan: normalized ${normalizationCount}/${args.events.length} event name(s) to Title Case`,
        );
      }
      const events =
        DEMO_MODE && normalizedEvents.length > 5
          ? normalizedEvents.slice(0, 5)
          : normalizedEvents;
      const batchTag =
        args.batchIndex !== undefined && args.totalBatches !== undefined
          ? ` batch=${args.batchIndex + 1}/${args.totalBatches}`
          : '';
      logToFile(
        `confirm_event_plan: ${events.length} events${
          DEMO_MODE ? ' (demo mode)' : ''
        }${batchTag}`,
      );
      // Strip callsites from the plan handed to the UI — the user-facing
      // prompt only needs name + description; callsites are an internal
      // recovery artifact persisted to disk.
      const uiEvents = events.map(({ name, description }) => ({
        name,
        description,
      }));
      const decision: EventPlanDecision = await getUI().promptEventPlan(
        uiEvents,
      );
      let text: string;
      if (decision.decision === 'revised') {
        text = `feedback: ${decision.feedback}`;
      } else {
        text = decision.decision; // 'approved' or 'skipped'
      }
      // Publish the outcome to the per-process singleton so the Stop hook
      // (in `agent-interface.ts`) can detect "user gave feedback but the
      // agent has not re-called this tool yet" and inject a re-prompt
      // instead of letting the run conclude with no event plan persisted.
      // Recorded for every decision so a subsequent approved/skipped also
      // clears the feedback state cleanly.
      recordEventPlanDecision({
        decision:
          decision.decision === 'revised' ? 'feedback' : decision.decision,
        events,
        feedback: decision.decision === 'revised' ? decision.feedback : '',
      });
      // Persist the canonical event plan to `.amplitude/events.json` so the
      // watcher and return-run loader see the same {name, description} shape
      // regardless of what the agent would otherwise emit. Only write on
      // approved to avoid overwriting a prior good plan with a rejected one.
      //
      // Paginated plans: batchIndex 0 (or absent) is always a fresh write;
      // subsequent batches MERGE into the existing file by name so the
      // call-site annotations from later batches accumulate without
      // dropping events confirmed in earlier batches.
      if (decision.decision === 'approved') {
        const isFirstBatch =
          args.batchIndex === undefined || args.batchIndex === 0;
        let toPersist: typeof events = events;
        if (!isFirstBatch) {
          // Merge with existing on-disk plan so we don't lose earlier batches.
          // Use the rich reader that preserves callsites so annotations from
          // prior batches accumulate across compaction boundaries. `null`
          // means missing/unparseable on disk — in that case there's nothing
          // to merge and we just persist the new batch on its own.
          const existing = readLocalEventPlanRich(workingDirectory) ?? [];
          const byName = new Map<
            string,
            {
              name: string;
              description: string;
              callsites?: Array<{ filePath: string; anchor?: string }>;
            }
          >();
          for (const e of existing) byName.set(e.name, e);
          for (const e of events) byName.set(e.name, e);
          toPersist = Array.from(byName.values()) as typeof events;
        }
        const persisted = persistEventPlan(workingDirectory, toPersist);
        logToFile(
          `confirm_event_plan: persist=${persisted} events=${toPersist.length}${batchTag}`,
        );
      }
      logToFile(`confirm_event_plan result: ${text}${batchTag}`);
      return { content: [{ type: 'text' as const, text }] };
    },
  );

  // -- propose_event_plan ---------------------------------------------------
  // Lightweight pre-flight tool the agent calls when it has a list of
  // candidate events and wants the wizard to compute a batching strategy
  // BEFORE entering the user-facing confirm_event_plan flow. For small
  // projects (≤50 events) the response says "single batch, just call
  // confirm_event_plan with the whole list" — preserving today's behavior.
  // For larger projects it returns suggested batch boundaries the runner
  // will use to drive the chunked write phase (SCALE_RESEARCH §C.2).
  //
  // This tool is read-only: it does not persist anything, does not block on
  // the user, and does not call into the UI. Its sole purpose is to push
  // chunking math out of the agent's head.
  const proposeEventPlan = tool(
    'propose_event_plan',
    `Compute the recommended batching strategy for a candidate event list BEFORE asking the user to confirm.

Call this tool when you have ≥1 candidate event and want the wizard to tell you how to chunk the write phase. Returns JSON: { totalEvents, paginated, chunkSize, suggestedBatches: [{batchIndex, totalBatches, start, end, eventNames}] }.

For small plans (≤50 events) suggestedBatches has a single entry covering all events. For larger plans the wizard splits into chunks of ~25 events (configurable via AMPLITUDE_WIZARD_EVENT_PLAN_CHUNK_SIZE) so each batch can be confirmed and instrumented under fresh context — avoiding context rot at ~120 events and compaction-induced plan amnesia at ~200 events.

This tool does not persist or prompt; it's a pure computation. Follow up with confirm_event_plan(events, batchIndex, totalBatches) per batch.`,
    {
      events: z
        .array(
          z.object({
            name: z
              .string()
              .describe(
                'Title Case event name (same shape as confirm_event_plan).',
              ),
            description: z
              .string()
              .optional()
              .describe('Optional one-line description.'),
          }),
        )
        .min(1)
        .describe(
          'The candidate event list, in the order they should be batched.',
        ),
      reason: reasonField,
    },
    async (args: {
      events: Array<{ name: string; description?: string }>;
      reason: string;
    }) => {
      const { buildBatches, resolveChunkSize, shouldPaginate } = await import(
        './event-plan-pagination.js'
      );
      const totalEvents = args.events.length;
      const chunkSize = resolveChunkSize();
      const paginated = shouldPaginate(totalEvents);
      // Below the threshold we still emit a single batch entry so the
      // schema is uniform — the agent can iterate the array unconditionally.
      const effectiveChunk = paginated ? chunkSize : totalEvents;
      const batches = buildBatches(totalEvents, effectiveChunk);
      const suggestedBatches = batches.map((b) => ({
        batchIndex: b.batchIndex,
        totalBatches: b.totalBatches,
        start: b.start,
        end: b.end,
        eventNames: args.events.slice(b.start, b.end).map((e) => e.name),
      }));
      const payload = {
        totalEvents,
        paginated,
        chunkSize: effectiveChunk,
        suggestedBatches,
      };
      logToFile(
        `propose_event_plan: total=${totalEvents} paginated=${paginated} chunkSize=${effectiveChunk} batches=${batches.length}`,
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
      };
    },
  );

  // -- report_status --------------------------------------------------------
  // Rate-limit per code: reject if the agent calls report_status for the same
  // (kind, code) more than `RATE_LIMIT_MAX` times inside RATE_LIMIT_WINDOW_MS.
  // Prevents the model from spamming status with duplicate reports.
  const RATE_LIMIT_WINDOW_MS = 1000;
  const RATE_LIMIT_MAX = 5;
  const reportHistory = new Map<string, number[]>();

  const reportStatus = tool(
    'report_status',
    'Report a structured status update (kind: "status") or a fatal error (kind: "error") to the wizard. Use instead of emitting [STATUS] or [ERROR-*] text markers in your output. The wizard routes status updates to the spinner and errors to the outro screen.',
    {
      kind: z
        .enum(['status', 'error'])
        .describe(
          '"status" for in-progress progress updates shown in the spinner; "error" to signal a fatal condition the wizard should surface on the outro.',
        ),
      code: z
        .string()
        .min(1)
        .max(64)
        .describe(
          'Machine-readable code. Errors: MCP_MISSING, RESOURCE_MISSING, API_ERROR, RATE_LIMIT, AUTH_ERROR. Status: short kebab-case identifier like "skill-loaded".',
        ),
      detail: z
        .string()
        .min(1)
        .max(500)
        .describe('Short human-readable message, shown verbatim to the user.'),
      reason: reasonField,
    },
    (args: {
      kind: StatusKind;
      code: string;
      detail: string;
      reason: string;
    }) => {
      const now = Date.now();
      const key = `${args.kind}:${args.code}`;
      const history = reportHistory.get(key) ?? [];
      // Drop events outside the rate window.
      const fresh = history.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      if (fresh.length >= RATE_LIMIT_MAX) {
        logToFile(
          `report_status rate-limited: ${key} (${fresh.length} calls in ${RATE_LIMIT_WINDOW_MS}ms)`,
        );
        return toWizardToolErrorContent({
          error: `rate-limited: too many ${key} reports in ${RATE_LIMIT_WINDOW_MS}ms`,
          guidance: `Stop reporting the same ${args.kind}/${args.code}. Move on to the next step — the wizard already received your earlier report. If the situation has materially changed, use a different code.`,
          context: `kind: ${args.kind}; code: ${args.code}; window: ${RATE_LIMIT_WINDOW_MS}ms; cap: ${RATE_LIMIT_MAX}`,
        });
      }
      fresh.push(now);
      reportHistory.set(key, fresh);

      const report: StatusReport = {
        kind: args.kind,
        code: args.code,
        detail: args.detail,
      };
      logToFile(`report_status: ${args.kind}/${args.code} — ${args.detail}`);
      const reporter = statusReporter?.();
      if (reporter) {
        if (args.kind === 'error') {
          reporter.onError(report);
        } else {
          reporter.onStatus(report);
        }
      }
      return {
        content: [{ type: 'text' as const, text: 'ok' }],
      };
    },
  );

  // -- record_dashboard -----------------------------------------------------
  // Persists a dashboard the agent just created via the Amplitude MCP. This
  // is the explicit hand-off from the in-loop agent (which does the actual
  // chart/dashboard MCP calls during the "Build your starter dashboard" task) to the
  // wizard's outro and post-agent step. Writes
  // `<installDir>/.amplitude/dashboard.json` (via persistDashboard).
  //
  // When this tool fires, `createDashboardStep` finds the file on its next
  // pass and short-circuits to its reuse path — no 90s MCP+sub-agent fallback,
  // no "Creating charts and dashboard in Amplitude…" spinner hang.
  const recordDashboard = tool(
    'record_dashboard',
    `Record an Amplitude dashboard you just created via the Amplitude MCP server.
Call this tool IMMEDIATELY after \`create_dashboard\` returns successfully — it persists the URL and chart metadata so the wizard's outro can link to it and the post-agent fallback step can short-circuit.
Required: dashboardUrl. Optional but recommended: dashboardId, charts (id/title/type per chart).
Returns: "ok" on successful persistence, an error string otherwise. Idempotent — safe to call again with updated values.`,
    {
      dashboardUrl: z
        .string()
        .url()
        .describe(
          'The full HTTPS URL to the created dashboard in Amplitude (e.g. https://app.amplitude.com/.../dashboard/abc123). Must be a valid URL — the outro renders this as a clickable link.',
        ),
      dashboardId: z
        .string()
        .min(1)
        .optional()
        .describe(
          'The dashboard ID returned by the Amplitude MCP create_dashboard call. Optional but recommended for downstream tooling.',
        ),
      charts: z
        .array(
          z.object({
            id: z.string().optional(),
            title: z.string().optional(),
            type: z.string().optional(),
          }),
        )
        .optional()
        .describe(
          'Metadata for each chart on the dashboard. Used by the wizard outro and analytics. Pass at least the title and type per chart (e.g. funnel, line, retention).',
        ),
      reason: reasonField,
    },
    (args: {
      dashboardUrl: string;
      dashboardId?: string;
      charts?: Array<{ id?: string; title?: string; type?: string }>;
      reason: string;
    }) => {
      const payload: Record<string, unknown> = {
        dashboardUrl: args.dashboardUrl,
      };
      if (args.dashboardId) payload.dashboardId = args.dashboardId;
      if (args.charts) payload.charts = args.charts;

      const persistedCanonical = persistDashboard(workingDirectory, payload);

      logToFile(
        `record_dashboard: url=${args.dashboardUrl} charts=${
          args.charts?.length ?? 0
        } canonical=${persistedCanonical}`,
      );

      // Surface the dashboard URL on the session immediately so the outro
      // (and any soft-error abort path in agent-runner that probes
      // `agentArtifactsLookComplete`) sees the success even if the rest of
      // the agent run trips on a late-stage flush. The post-agent step also
      // sets this, but doing it here makes the in-loop path self-contained.
      try {
        getUI().setDashboardUrl(args.dashboardUrl);
      } catch (err) {
        logToFile(
          `record_dashboard: ui.setDashboardUrl failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      if (!persistedCanonical) {
        return toWizardToolErrorContent({
          error: 'failed to persist dashboard to disk',
          guidance: `The wizard could not write .amplitude/dashboard.json. The dashboard URL has already been surfaced to the UI, so do NOT call record_dashboard again — note the persistence failure in the setup report and proceed.`,
          context: `dashboardUrl: ${args.dashboardUrl}; workingDirectory: ${workingDirectory}`,
        });
      }
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    },
  );

  // -- record_dashboard_plan ------------------------------------------------
  // Persists the agent's chart + dashboard PLAN — the strategist output, not
  // the actual created dashboard. This is the deferred-dashboard hand-off:
  // the agent declares what charts and dashboard it wants, and a separate
  // `wizard dashboard` command (PR 3) consumes the artifact later, once
  // event ingestion has caught up, to actually create them in Amplitude.
  //
  // PR 2 only registers the tool — it is intentionally NOT wired into the
  // agent's prompt yet. PR 4 swaps the main run over from `record_dashboard`
  // (which hits Amplitude inline) to `record_dashboard_plan` (deferred).
  // For now this tool is additive: today's `record_dashboard` still ships,
  // and nothing reads `dashboard-plan.json` outside the deferred command +
  // its tests. Behavior is unchanged.
  //
  // Writes `<installDir>/.amplitude/dashboard-plan.json` via writeDashboardPlan
  // (which stamps `version`, `planId`, `createdAt`).
  const recordDashboardPlan = tool(
    'record_dashboard_plan',
    `Record the chart + dashboard plan you intend to build, BEFORE actually creating anything in Amplitude.
Used by the deferred dashboard flow: a separate command (\`wizard dashboard\`) reads the persisted plan and creates the charts + dashboard once event ingestion catches up.
Required: orgId, projectId, events, charts, dashboard. \`planId\` and \`createdAt\` are stamped by the wizard.
Returns: "ok: <planId>" on successful persistence, an error string otherwise. Idempotent — calling again overwrites the prior plan with a fresh \`planId\`.`,
    {
      orgId: z
        .string()
        .min(1)
        .describe(
          'Numeric Amplitude org id — the same value the wizard wrote into project-binding.json.',
        ),
      projectId: z
        .string()
        .min(1)
        .describe(
          'Numeric Amplitude project (app) id — the same value the wizard wrote into project-binding.json.',
        ),
      events: z
        .array(
          z.object({
            name: z.string().min(1),
            properties: z.array(z.string().min(1)).optional(),
          }),
        )
        .describe(
          'Events the plan covers. Mirror the confirmed event plan from `confirm_event_plan` so the deferred command can intersect it with what is actually being ingested.',
        ),
      charts: z
        .array(
          z.object({
            title: z.string().min(1),
            eventName: z.string().min(1),
            chartType: z.enum([
              'funnel',
              'line',
              'bar',
              'pie',
              'retention',
              'segmentation',
              'unknown',
            ]),
            grouping: z.string().min(1).optional(),
            metadata: z.record(z.string(), z.unknown()).optional(),
          }),
        )
        .describe(
          'Charts to build. Each chart references an event by name (must match an entry in `events`). `metadata` is a forward-compat slot for skill-specific extras.',
        ),
      dashboard: z
        .object({
          title: z.string().min(1),
          layout: z.enum(['grid', 'list']).optional(),
        })
        .describe('The dashboard wrapper — title and optional layout.'),
      reason: reasonField,
    },
    async (args: {
      orgId: string;
      projectId: string;
      events: Array<{ name: string; properties?: string[] }>;
      charts: Array<{
        title: string;
        eventName: string;
        chartType:
          | 'funnel'
          | 'line'
          | 'bar'
          | 'pie'
          | 'retention'
          | 'segmentation'
          | 'unknown';
        grouping?: string;
        metadata?: Record<string, unknown>;
      }>;
      dashboard: { title: string; layout?: 'grid' | 'list' };
      reason: string;
    }) => {
      // Lazy import — keeps the dashboard-plan module out of the wizard-tools
      // module-init graph for any consumer that doesn't actually call this
      // tool (e.g. the external `wizard-mcp-server` registers its own copy).
      const { writeDashboardPlan } = await import('./dashboard-plan.js');
      const persisted = writeDashboardPlan(workingDirectory, {
        orgId: args.orgId,
        projectId: args.projectId,
        events: args.events,
        charts: args.charts,
        dashboard: args.dashboard,
      });

      logToFile(
        `record_dashboard_plan: charts=${args.charts.length} events=${
          args.events.length
        } persisted=${persisted ? persisted.planId : 'failed'}`,
      );

      if (!persisted) {
        return toWizardToolErrorContent({
          error: 'failed to persist dashboard plan to disk',
          guidance: `The wizard could not write .amplitude/dashboard-plan.json. Do NOT call record_dashboard_plan again with the same payload — note the persistence failure in the setup report and proceed; the user can re-run the deferred dashboard command later.`,
          context: `workingDirectory: ${workingDirectory}; charts: ${args.charts.length}; events: ${args.events.length}`,
        });
      }
      return {
        content: [{ type: 'text' as const, text: `ok: ${persisted.planId}` }],
      };
    },
  );

  // -- wizard_feedback ------------------------------------------------------
  // Structured agent-side feedback for blocked or stuck states. Distinct from
  // the user-facing /feedback slash command (`trackWizardFeedback`); this one
  // is invoked by the agent itself when it can't move forward, and emits a
  // queryable event for Agent Analytics so we can find broken flows without
  // grepping logs. Only used for in-run blockers — successful runs should not
  // call this.
  const wizardFeedback = tool(
    'wizard_feedback',
    'Report a structured blocker or warning when you (the agent) cannot move forward. Use this for unresolvable states, unexpected codebase shapes, missing prerequisites, or persistent tool failures — NOT for routine progress updates (use report_status for those). Surfaces as a queryable signal in Agent Analytics so the team can see where runs get stuck.',
    {
      goal: z
        .string()
        .min(1)
        .max(500)
        .describe('What you were trying to accomplish at this step.'),
      steps_tried: z
        .array(z.string().min(1).max(500))
        .min(1)
        .describe(
          'The concrete steps or tool calls you attempted before reporting this blocker.',
        ),
      blocker: z
        .string()
        .min(1)
        .max(1000)
        .describe(
          'What is preventing you from continuing — error message, missing file, ambiguous codebase shape, etc.',
        ),
      severity: z
        .enum(['warn', 'error'])
        .describe(
          '"warn" if you can continue with a degraded result; "error" if the run cannot proceed.',
        ),
      reason: reasonField,
    },
    (args: {
      goal: string;
      steps_tried: string[];
      blocker: string;
      severity: 'warn' | 'error';
      reason: string;
    }) => {
      logToFile(
        `wizard_feedback (${args.severity}): goal="${args.goal}" blocker="${args.blocker}"`,
      );
      // Lazy-import to avoid a static dependency cycle: utils/analytics
      // imports from lib/* indirectly through other shared modules, and we
      // want this MCP server to remain importable from anywhere without
      // pulling the analytics client into module init.
      void (async () => {
        try {
          const { analytics } = await import('../utils/analytics.js');
          analytics.wizardCapture('agent feedback submitted', {
            goal: args.goal,
            'steps tried': args.steps_tried,
            blocker: args.blocker,
            severity: args.severity,
            reason: args.reason,
          });
        } catch (err) {
          logToFile(
            `wizard_feedback: analytics emit failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      })();
      return {
        content: [{ type: 'text' as const, text: 'feedback recorded' }],
      };
    },
  );

  // -- Assemble server ------------------------------------------------------

  const rawServer = createSdkMcpServer({
    name: SERVER_NAME,
    version: '1.0.0',
    tools: [
      checkEnvKeys,
      setEnvValues,
      detectPM,
      ...tieredSkillTools,
      // loadSkillMenu and installSkill intentionally not exposed — see
      // the disabled-tool block above for context. Constant skills are
      // pre-installed at runtime so the agent can `Skill.load` them
      // directly.
      confirm,
      choose,
      confirmEventPlan,
      proposeEventPlan,
      reportStatus,
      recordDashboard,
      // PR 2 of DEFER_DASHBOARD_PLAN: additive — registered so it is
      // callable, but not yet referenced in agent prompts. PR 4 wires it
      // in and retires `record_dashboard`.
      recordDashboardPlan,
      wizardFeedback,
    ],
  });

  // Wrap with Sentry auto-instrumentation so every wizard-tools call gets a
  // span in the active trace. No-op when telemetry is disabled — returns
  // the raw server unchanged. The agent SDK types `createSdkMcpServer` as
  // returning `unknown`, so we narrow to `object` here for the wrapper.
  return wrapMcpServerWithSentry(rawServer as object);
}

/** Tool names exposed by the wizard-tools server, for use in allowedTools */
export const WIZARD_TOOL_NAMES = [
  `${SERVER_NAME}:check_env_keys`,
  `${SERVER_NAME}:set_env_values`,
  `${SERVER_NAME}:detect_package_manager`,
  // load_skill_menu / install_skill intentionally omitted while the
  // skill catalogue / download path is broken — see the disabled-tool
  // block in this file for context.
  `${SERVER_NAME}:confirm`,
  `${SERVER_NAME}:choose`,
  `${SERVER_NAME}:confirm_event_plan`,
  // Lightweight pre-flight that returns suggested batch boundaries for the
  // agent. Call this BEFORE confirm_event_plan when the candidate list is
  // ≥1 event — the response tells you whether to single-batch or paginate.
  `${SERVER_NAME}:propose_event_plan`,
  `${SERVER_NAME}:report_status`,
  `${SERVER_NAME}:record_dashboard`,
  // PR 2 of DEFER_DASHBOARD_PLAN: registered so the agent CAN call it,
  // but no prompt copy references it yet. PR 4 wires it in.
  `${SERVER_NAME}:record_dashboard_plan`,
  `${SERVER_NAME}:wizard_feedback`,
];

/**
 * Tool names allowed for the inner agent, including the tiered skill
 * delivery tools.
 *
 * Tiered skill delivery is **default-on** (opt out with
 * `AMPLITUDE_WIZARD_SKILL_TIERS=0`). When enabled, this appends
 * `load_skill_menu` / `load_skill` / `load_skill_reference` to the
 * canonical {@link WIZARD_TOOL_NAMES} list — must match the tools
 * registered in {@link createWizardToolsServer}.
 */
export function resolveWizardAllowedToolNames(): string[] {
  const names = [...WIZARD_TOOL_NAMES];
  if (isSkillTiersEnabled()) {
    names.push(`${SERVER_NAME}:load_skill_menu`);
    names.push(`${SERVER_NAME}:load_skill`);
    names.push(`${SERVER_NAME}:load_skill_reference`);
  }
  return names;
}

/** Stable server name — used by hooks to namespace `mcp__wizard-tools__*` tool calls. */
export const WIZARD_TOOLS_SERVER_NAME = SERVER_NAME;
