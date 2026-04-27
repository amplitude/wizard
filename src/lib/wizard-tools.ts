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
import { z } from 'zod';
import { logToFile } from '../utils/debug';
import { atomicWriteJSON } from '../utils/atomic-write';
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

// ---------------------------------------------------------------------------
// Skill types
// ---------------------------------------------------------------------------

export type SkillEntry = { id: string; name: string; downloadUrl: string };

export interface SkillMenu {
  categories: Record<string, SkillEntry[]>;
}

// ---------------------------------------------------------------------------
// Remote skill helpers — for future use with amplitude/context-hub releases.
// Currently unused; skills are bundled locally. Enable by setting SKILLS_URL
// env var (e.g. https://github.com/amplitude/context-hub/releases/latest/download).
// ---------------------------------------------------------------------------

/**
 * Fetch the skill menu from a remote skills server (GitHub Releases).
 * Returns parsed data on success, `null` on failure.
 */
export async function fetchSkillMenu(
  skillsBaseUrl: string,
): Promise<SkillMenu | null> {
  try {
    const menuUrl = `${skillsBaseUrl}/skill-menu.json`;
    logToFile(`fetchSkillMenu: fetching from ${menuUrl}`);
    const resp = await fetch(menuUrl);
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
    logToFile(
      `fetchSkillMenu: error: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

/**
 * Download and extract a skill from a remote URL.
 * Installs to `<installDir>/.claude/skills/<id>/`.
 */
export function downloadSkill(
  skillEntry: SkillEntry,
  installDir: string,
): { success: boolean; error?: string } {
  const { execFileSync } =
    require('child_process') as typeof import('child_process');
  const skillDir = path.join(installDir, '.claude', 'skills', skillEntry.id);
  const tmpFile = `/tmp/amplitude-skill-${skillEntry.id}.zip`;

  try {
    fs.mkdirSync(skillDir, { recursive: true });
    execFileSync('curl', ['-sL', skillEntry.downloadUrl, '-o', tmpFile], {
      timeout: 30000,
    });
    execFileSync('unzip', ['-o', tmpFile, '-d', skillDir], {
      timeout: 30000,
    });
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* ignore cleanup errors */
    }

    logToFile(
      `downloadSkill: installed ${skillEntry.id} from ${skillEntry.downloadUrl}`,
    );
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToFile(`downloadSkill: error: ${msg}`);
    return { success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Bundled skill helpers — reads skills from wizard/skills/integration/
// ---------------------------------------------------------------------------

/**
 * Resolve the bundled skills root directory.
 * Skills are shipped in `<wizardRoot>/skills/<category>/` subdirectories.
 */
function getSkillsRootDir(): string {
  // Walk up from this file to find the wizard repo root (where skills/ lives)
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'skills'))) {
      return path.join(dir, 'skills');
    }
    dir = path.dirname(dir);
  }
  // Fallback: relative to cwd
  return path.join(process.cwd(), 'skills');
}

/**
 * Build skill menu from bundled skill directories.
 * Scans skills/<category>/ subdirectories for folders containing SKILL.md.
 * Each subdirectory of skills/ becomes a category (e.g. integration, instrumentation).
 */
export function loadBundledSkillMenu(): SkillMenu {
  const skillsRoot = getSkillsRootDir();
  logToFile(`loadBundledSkillMenu: scanning ${skillsRoot}`);
  const categories: Record<string, SkillEntry[]> = {};

  try {
    for (const category of fs.readdirSync(skillsRoot)) {
      const categoryPath = path.join(skillsRoot, category);
      if (!fs.statSync(categoryPath).isDirectory()) continue;

      const entries: SkillEntry[] = [];
      for (const name of fs.readdirSync(categoryPath)) {
        const skillPath = path.join(categoryPath, name);
        const skillMd = path.join(skillPath, 'SKILL.md');
        if (fs.statSync(skillPath).isDirectory() && fs.existsSync(skillMd)) {
          // Extract display name from SKILL.md frontmatter
          const content = fs.readFileSync(skillMd, 'utf8');
          const descMatch = content.match(/^description:\s*>-?\s*\n\s+(.+)/m);
          const fallbackName = name
            .replace(new RegExp(`^${category}-`), '')
            .replace(/-/g, ' ');
          const displayName = descMatch ? descMatch[1].trim() : fallbackName;
          entries.push({ id: name, name: displayName, downloadUrl: '' });
        }
      }
      if (entries.length > 0) {
        categories[category] = entries;
      }
    }
  } catch (err) {
    logToFile(
      `loadBundledSkillMenu: error scanning: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const total = Object.values(categories).reduce(
    (sum, entries) => sum + entries.length,
    0,
  );
  logToFile(
    `loadBundledSkillMenu: found ${total} skills across ${
      Object.keys(categories).length
    } categories`,
  );
  return { categories };
}

/**
 * Strict skill-id allowlist: lowercase alphanumeric with hyphens or underscores
 * only. Used to gate any path.join with a skillId so a hostile or malformed
 * id can never escape the skills root via traversal characters (`..`, `/`).
 */
const SKILL_ID_ALLOWLIST = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Check whether a bundled skill exists on disk by searching across all
 * category subdirectories under skills/. Used to decide whether to pre-stage
 * a skill before the agent runs vs leave the agent to discover via the
 * load_skill_menu fallback.
 */
export function bundledSkillExists(skillId: string): boolean {
  // Reject any skillId that's not a strict basename — defense in depth before
  // the path.join below (skillId comes from internal callers but we treat it
  // as untrusted at the boundary).
  if (!SKILL_ID_ALLOWLIST.test(skillId)) return false;
  const skillsRoot = getSkillsRootDir();
  try {
    for (const category of fs.readdirSync(skillsRoot)) {
      // Same defense for category names read off disk.
      if (!SKILL_ID_ALLOWLIST.test(category)) continue;
      // skillId and category are both validated against SKILL_ID_ALLOWLIST
      // above, so neither can contain `..` or path separators.
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      const candidate = path.join(skillsRoot, category, skillId);
      if (
        fs.existsSync(candidate) &&
        fs.statSync(candidate).isDirectory() &&
        // candidate is derived solely from the validated inputs above.
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
        fs.existsSync(path.join(candidate, 'SKILL.md'))
      ) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Pre-stage a deterministic set of skills into the user's `.claude/skills/`
 * directory before the agent runs, so the agent can load them via the Skill
 * tool without having to call load_skill_menu / install_skill in a loop.
 *
 * The constant skills (taxonomy + instrumentation + dashboard) are always
 * the same; the integration skill is resolved per framework via the optional
 * resolver and may be null if no matching skill exists on disk.
 *
 * Returns the list of skill IDs that were successfully staged.
 */
export function preStageSkills(
  installDir: string,
  integrationSkillId: string | null,
): { staged: string[]; integrationStaged: boolean } {
  const constantSkills = [
    'amplitude-quickstart-taxonomy-agent',
    'add-analytics-instrumentation',
    'amplitude-chart-dashboard-plan',
  ];
  const staged: string[] = [];
  for (const id of constantSkills) {
    if (!bundledSkillExists(id)) {
      logToFile(`preStageSkills: skipping ${id} — not bundled`);
      continue;
    }
    const result = installBundledSkill(id, installDir);
    if (result.success) {
      staged.push(id);
    } else {
      logToFile(`preStageSkills: failed to stage ${id}: ${result.error}`);
    }
  }
  let integrationStaged = false;
  if (integrationSkillId && bundledSkillExists(integrationSkillId)) {
    const result = installBundledSkill(integrationSkillId, installDir);
    if (result.success) {
      staged.push(integrationSkillId);
      integrationStaged = true;
    } else {
      logToFile(
        `preStageSkills: failed to stage integration skill ${integrationSkillId}: ${result.error}`,
      );
    }
  }
  logToFile(`preStageSkills: staged [${staged.join(', ')}]`);
  return { staged, integrationStaged };
}

/**
 * Install a bundled skill by copying it to the project's .claude/skills/ dir.
 * Searches across all category subdirectories under skills/.
 */
export function installBundledSkill(
  skillId: string,
  installDir: string,
): { success: boolean; error?: string } {
  const skillsRoot = getSkillsRootDir();
  const dest = path.join(installDir, '.claude', 'skills', skillId);

  try {
    for (const category of fs.readdirSync(skillsRoot)) {
      const src = path.join(skillsRoot, category, skillId);
      if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
        fs.cpSync(src, dest, { recursive: true });
        logToFile(
          `installBundledSkill: copied ${skillId} from ${src} to ${dest}`,
        );
        return { success: true };
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToFile(`installBundledSkill: error: ${msg}`);
    return { success: false, error: msg };
  }

  return { success: false, error: `Bundled skill "${skillId}" not found` };
}

/**
 * Patterns the wizard writes into the user's project that should never be
 * committed to git. Kept as a const so `ensureWizardArtifactsIgnored` has a
 * single source of truth for what to add to the user's .gitignore.
 *
 * The list is broader than what `cleanupWizardArtifacts` removes on exit:
 * several entries are kept on disk on purpose (legacy mirrors useful for
 * context-hub skill compatibility, the user-facing setup report, the
 * canonical `.amplitude/` metadata dir) but should still never end up in
 * source control.
 *
 * Notes on each entry:
 *   - `.amplitude/` — per-project metadata dir holding `events.json` (the
 *     approved event plan, kept across runs for re-instrumentation) and
 *     `dashboard.json` (the URL of the dashboard the agent created). Useful
 *     to keep on disk but never belongs in source control.
 *   - `.amplitude-events.json` / `.amplitude-dashboard.json` — legacy
 *     mirrors. The wizard tool dual-writes events here so bundled
 *     context-hub integration skills (which still read the legacy path)
 *     keep working; the agent's conclude-phase skill writes the
 *     dashboard mirror itself. Both are intentionally PRESERVED across
 *     runs (re-instrumentation needs them, and the canonical mirrors
 *     under `.amplitude/` already cover the same data) — they're listed
 *     here only to keep them out of `git add .`. Drop these entries
 *     once context-hub ships an updated skill set that reads/writes the
 *     canonical `.amplitude/` paths.
 *   - `amplitude-setup-report.md` — user-facing summary the OutroScreen
 *     points the user at after a successful run. Intentionally kept at
 *     the project root (so the path is short and discoverable) and
 *     intentionally NOT cleaned up — the user is meant to read it after
 *     the run and the next run overwrites it. Gitignored so it doesn't
 *     get committed by accident.
 *   - `.claude/skills/integration-...` — single-use SDK-setup workflows;
 *     removed at end of run. (Pattern is `integration-...slash` in gitignore.)
 *   - The instrumentation/taxonomy skills are kept on disk so users can
 *     invoke them later ("Claude, use the chart-dashboard-plan skill"), but
 *     they're still gitignored — committing them would balloon every PR
 *     diff and surprise users who run `git add .` after the wizard.
 */
export const WIZARD_GITIGNORE_PATTERNS: readonly string[] = [
  '.amplitude/',
  '.amplitude-events.json',
  '.amplitude-dashboard.json',
  'amplitude-setup-report.md',
  '.claude/skills/integration-*/',
  '.claude/skills/add-analytics-instrumentation/',
  '.claude/skills/amplitude-chart-dashboard-plan/',
  '.claude/skills/amplitude-quickstart-taxonomy-agent/',
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
 * Run wizard-artifact cleanup.
 *
 * Currently composes a single step:
 *   - cleanupIntegrationSkills (remove `.claude/skills/integration-*`,
 *     onSuccess only — preserves them on cancel/error so a re-run
 *     doesn't re-download the skill)
 *
 * Notes on what's intentionally PRESERVED on every exit (success, cancel,
 * error):
 *   - `<installDir>/.amplitude/events.json` and `dashboard.json` —
 *     the canonical project metadata. `events.json` is the authoritative
 *     record of the user's confirmed event plan and is reused across
 *     runs for re-instrumentation. Both are gitignored via the
 *     `.amplitude/` pattern so they can't pollute commits.
 *   - `<installDir>/.amplitude-events.json` and `.amplitude-dashboard.json` —
 *     legacy mirrors. The wizard dual-writes events here for bundled
 *     context-hub integration skills that still read the legacy path,
 *     and the agent's conclude-phase skill writes the dashboard mirror
 *     itself. Both are listed in `WIZARD_GITIGNORE_PATTERNS` so they
 *     can't pollute commits, and intentionally NOT deleted — preserving
 *     them across runs avoids resurfacing an empty-disk state to the
 *     skills mid-run and keeps re-instrumentation cheap.
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
 * Ensure the given env file basename is covered by .gitignore in the working directory.
 * Creates .gitignore if it doesn't exist; appends the entry if missing.
 */
export function ensureGitignoreCoverage(
  workingDirectory: string,
  envFileName: string,
): void {
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
// Event plan persistence
// ---------------------------------------------------------------------------

/**
 * Write the canonical event plan to `<workingDirectory>/.amplitude/events.json`
 * using the shape the wizard UI expects: `[{name, description}]`.
 *
 * Also mirror the file to the legacy `<workingDirectory>/.amplitude-events.json`
 * for backwards compatibility with bundled integration skills that still
 * instruct the agent to read the legacy path. Both files are gitignored
 * (`.amplitude/` covers the canonical path; the legacy dotfile is listed
 * explicitly in WIZARD_GITIGNORE_PATTERNS) and intentionally preserved
 * across runs for re-instrumentation. Drop the mirror once context-hub
 * ships an updated skill set that reads the canonical path.
 *
 * The agent is instructed (via commandments + integration skills) not to
 * write either file itself — the wizard tool is the single writer so the
 * shape can't drift. Exported for testing.
 *
 * The `.amplitude/` directory is created lazily on first write and is
 * gitignored as a single line.
 *
 * Returns true on success, false on any filesystem error (the caller logs
 * but doesn't fail the tool call over persistence issues).
 */
export function persistEventPlan(
  workingDirectory: string,
  events: Array<{ name: string; description: string }>,
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
    // Canonical location — preserved across runs, gitignored as `.amplitude/`.
    ensureDir(getProjectMetaDir(workingDirectory), 0o755);
    atomicWriteJSON(getEventsFile(workingDirectory), events);
    // Legacy mirror — bundled integration skills (owned by context-hub)
    // still instruct the agent to read this path. Once context-hub ships
    // an updated skill set pointing at `.amplitude/events.json` we can
    // drop this mirror and its gitignore entry.
    const legacyPlanPath = path.join(
      workingDirectory,
      '.amplitude-events.json',
    );
    atomicWriteJSON(legacyPlanPath, events);
    return true;
  } catch (err) {
    logToFile(
      `persistEventPlan: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/**
 * Mirror the dashboard payload to the canonical
 * `<workingDirectory>/.amplitude/dashboard.json`. Bundled integration skills
 * instruct the agent to write only the legacy `.amplitude-dashboard.json`;
 * this function copies the content to the canonical path so downstream
 * consumers (and a future context-hub release that drops the legacy path)
 * have a stable location to read from. Both files are gitignored and
 * preserved across runs.
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
 * Read the canonical event plan from `.amplitude-events.json` if present.
 * Returns an empty array on any failure — the fallback writer is best-effort
 * and a missing / malformed events file just means the report has no events
 * table, not that the report should be skipped.
 */
function readPersistedEventPlan(
  installDir: string,
): Array<{ name: string; description: string }> {
  try {
    const planPath = path.join(installDir, '.amplitude-events.json');
    if (!fs.existsSync(planPath)) return [];
    const raw = fs.readFileSync(planPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is { name: string; description: string } =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as { name?: unknown }).name === 'string' &&
          typeof (e as { description?: unknown }).description === 'string',
      )
      .map((e) => ({ name: e.name, description: e.description }));
  } catch (err) {
    logToFile(
      `readPersistedEventPlan: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [];
  }
}

/**
 * Render a minimal Markdown setup report from session state. Exported so
 * tests can lock down the formatting without going through the filesystem.
 */
export function buildFallbackReport(ctx: FallbackReportContext): string {
  const events = readPersistedEventPlan(ctx.installDir);
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
      '_No event plan was persisted. If this is unexpected, re-run the wizard or check `.amplitude-events.json` in your project root._',
    );
    lines.push('');
  }

  lines.push('## Analytics dashboard');
  lines.push('');
  if (ctx.dashboardUrl) {
    lines.push(`Open your dashboard: ${ctx.dashboardUrl}`);
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

  // Load skill menu: try remote first, fall back to bundled
  const menu = skillsBaseUrl
    ? (await fetchSkillMenu(skillsBaseUrl)) ?? loadBundledSkillMenu()
    : loadBundledSkillMenu();
  const cachedSkillMenu: Record<string, SkillEntry[]> = menu?.categories ?? {};

  const keys = Object.keys(cachedSkillMenu);
  const categoryNames: [string, ...string[]] =
    keys.length > 0 ? (keys as [string, ...string[]]) : ['integration'];

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
    },
    (args: { filePath: string; keys: string[] }) => {
      const resolved = resolveEnvPath(workingDirectory, args.filePath);
      logToFile(`check_env_keys: ${resolved}, keys: ${args.keys.join(', ')}`);

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
    'Create or update environment variable keys in a .env file. Creates the file if it does not exist. Ensures .gitignore coverage.',
    {
      filePath: z
        .string()
        .describe('Path to the .env file, relative to the project root'),
      values: z
        .record(z.string(), z.string())
        .describe('Key-value pairs to set'),
    },
    (args: { filePath: string; values: Record<string, string> }) => {
      const resolved = resolveEnvPath(workingDirectory, args.filePath);
      logToFile(
        `set_env_values: ${resolved}, keys: ${Object.keys(args.values).join(
          ', ',
        )}`,
      );

      const existing = fs.existsSync(resolved)
        ? fs.readFileSync(resolved, 'utf8')
        : '';
      const content = mergeEnvValues(existing, args.values);

      // Ensure parent directory exists
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(resolved, content, 'utf8');

      // Ensure .gitignore coverage for this env file
      const envFileName = path.basename(resolved);
      ensureGitignoreCoverage(workingDirectory, envFileName);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Updated ${Object.keys(args.values).length} key(s) in ${
              args.filePath
            }`,
          },
        ],
      };
    },
  );

  // -- detect_package_manager -----------------------------------------------

  const detectPM = tool(
    'detect_package_manager',
    'Detect which package manager(s) the project uses. Returns the name, install command, and run command for each detected package manager. Call this before running any install commands.',
    {},
    async () => {
      logToFile(`detect_package_manager: scanning ${workingDirectory}`);

      const result = await detectPackageManager(workingDirectory);

      logToFile(
        `detect_package_manager: detected ${result.detected.length} package manager(s)`,
      );

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

  // -- load_skill_menu ------------------------------------------------------

  const loadSkillMenu = tool(
    'load_skill_menu',
    'Load available Amplitude skills for a category. Returns skill IDs and names. Call this first, then use install_skill with the chosen ID.',
    {
      category: z.enum(categoryNames).describe('Skill category'),
    },
    (args: { category: string }) => {
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

  // -- install_skill --------------------------------------------------------

  const installSkill = tool(
    'install_skill',
    'Download and install an Amplitude skill by ID. Call load_skill_menu first to see available skills. Extracts the skill to .claude/skills/<skillId>/.',
    {
      skillId: z
        .string()
        .describe(
          'Skill ID from the skill menu (e.g., "integration-nextjs-app-router")',
        ),
    },
    (args: { skillId: string }) => {
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

      // Look up download URL from cached menu
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

      // Try remote download if URL available, otherwise use bundled copy
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

  // -- confirm --------------------------------------------------------------

  const confirm = tool(
    'confirm',
    'Ask the user a yes/no question and wait for their answer. Returns true if confirmed, false if declined or skipped.',
    {
      message: z
        .string()
        .describe('The confirmation question to show the user'),
    },
    async (args: { message: string }) => {
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
    },
    async (args: { message: string; options: string[] }) => {
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
If the user gives feedback, revise your plan and call this tool again — loop until approved or skipped.
Returns: "approved", "skipped", or "feedback: <user message>"`,
    {
      events: z
        .array(
          z.object({
            name: z
              .string()
              .describe(
                'Short lowercase event name using spaces for separators, e.g. "user signed up", "product added to cart", "search performed". This is displayed as a bold label — keep it concise (2-5 words). Do NOT put descriptions or file paths here.',
              ),
            description: z
              .string()
              .describe(
                'One short sentence (≤20 words) stating when this event fires. Do NOT include file paths, property lists, autocapture rationale, or implementation notes — those belong in internal planning, not in the user-facing plan.',
              ),
          }),
        )
        .min(1)
        .describe('The list of events you plan to instrument'),
    },
    async (args: { events: Array<{ name: string; description: string }> }) => {
      const { DEMO_MODE } = await import('./constants.js');
      // Light normalization — truncate overly long names but don't try to
      // extract names from descriptions.
      const normalizedEvents = args.events.map((e) => ({
        name:
          e.name.trim().length > 50
            ? e.name.trim().slice(0, 45) + '…'
            : e.name.trim(),
        description: e.description?.trim() || '',
      }));
      const events =
        DEMO_MODE && normalizedEvents.length > 5
          ? normalizedEvents.slice(0, 5)
          : normalizedEvents;
      logToFile(
        `confirm_event_plan: ${events.length} events${
          DEMO_MODE ? ' (demo mode)' : ''
        }`,
      );
      const decision: EventPlanDecision = await getUI().promptEventPlan(events);
      let text: string;
      if (decision.decision === 'revised') {
        text = `feedback: ${decision.feedback}`;
      } else {
        text = decision.decision; // 'approved' or 'skipped'
      }
      // Persist the canonical event plan to .amplitude-events.json so the
      // watcher and return-run loader see the same {name, description} shape
      // regardless of what the agent would otherwise emit. Only write on
      // approved to avoid overwriting a prior good plan with a rejected one.
      if (decision.decision === 'approved') {
        const persisted = persistEventPlan(workingDirectory, events);
        logToFile(
          `confirm_event_plan: persist=${persisted} events=${events.length}`,
        );
      }
      logToFile(`confirm_event_plan result: ${text}`);
      return { content: [{ type: 'text' as const, text }] };
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
    },
    (args: { kind: StatusKind; code: string; detail: string }) => {
      const now = Date.now();
      const key = `${args.kind}:${args.code}`;
      const history = reportHistory.get(key) ?? [];
      // Drop events outside the rate window.
      const fresh = history.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      if (fresh.length >= RATE_LIMIT_MAX) {
        logToFile(
          `report_status rate-limited: ${key} (${fresh.length} calls in ${RATE_LIMIT_WINDOW_MS}ms)`,
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: `rate_limited: pause before reporting ${key} again`,
            },
          ],
        };
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

  // -- Assemble server ------------------------------------------------------

  const rawServer = createSdkMcpServer({
    name: SERVER_NAME,
    version: '1.0.0',
    tools: [
      checkEnvKeys,
      setEnvValues,
      detectPM,
      loadSkillMenu,
      installSkill,
      confirm,
      choose,
      confirmEventPlan,
      reportStatus,
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
  `${SERVER_NAME}:load_skill_menu`,
  `${SERVER_NAME}:install_skill`,
  `${SERVER_NAME}:confirm`,
  `${SERVER_NAME}:choose`,
  `${SERVER_NAME}:confirm_event_plan`,
  `${SERVER_NAME}:report_status`,
];
