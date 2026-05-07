/**
 * Bundled skill discovery + install — reads from `<wizardRoot>/skills/<category>/`.
 * Extracted from wizard-tools.ts so the MCP server module stays easier to navigate.
 */

import path from 'path';
import fs from 'fs';
import { logToFile } from '../../utils/debug.js';

// ---------------------------------------------------------------------------
// Skill types (shared with remote `fetchSkillMenu` payloads)
// ---------------------------------------------------------------------------

export type SkillEntry = { id: string; name: string; downloadUrl: string };

export interface SkillMenu {
  categories: Record<string, SkillEntry[]>;
}

// ---------------------------------------------------------------------------
// Tier-1 / Tier-2 skill delivery feature flag
// ---------------------------------------------------------------------------

/**
 * Resolve the AMPLITUDE_WIZARD_SKILL_TIERS feature flag.
 *
 * Default-on (per the perf-skill-tiers rollout): the wizard pre-stages only
 * a Tier-1 menu and serves skill bodies via the `load_skill` /
 * `load_skill_reference` tools. This collapses ~47K eagerly-staged tokens
 * out of the cold-start prompt prefix, which on a real run was 12.8x over
 * the 7.5K budget.
 *
 * Explicit opt-out: set `AMPLITUDE_WIZARD_SKILL_TIERS=0` to restore the
 * previous eager-pre-stage path. Useful for debugging and as a safety
 * valve if a regression slips through.
 *
 * Anything other than the literal string `'0'` (including unset, `'1'`,
 * `'true'`, `''`) keeps tiers enabled — we treat the flag as default-on
 * with a single explicit kill switch rather than a tristate.
 */
export function isSkillTiersEnabled(): boolean {
  return process.env.AMPLITUDE_WIZARD_SKILL_TIERS !== '0';
}

/**
 * Filename for the Tier-1 menu file written into the user's project.
 * Lives at `<installDir>/.claude/skills/skill-menu.json`.
 */
export const SKILL_MENU_FILENAME = 'skill-menu.json';

/**
 * Tier-1 menu shape — what gets serialized into `skill-menu.json` and
 * returned by the `load_skill_menu` MCP tool. Keep in sync between the
 * file writer (`writeSkillMenuFile`) and the tool response so the agent
 * can use either source interchangeably.
 */
export interface SkillMenuFileContent {
  categories: Record<string, { id: string; name: string }[]>;
}

// ---------------------------------------------------------------------------
// Bundled skill helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the bundled skills root directory.
 * Skills are shipped at `<wizardPackageRoot>/skills/<category>/` — sibling
 * to the package's `package.json`.
 *
 * Walks up from this module looking for the nearest `package.json` whose
 * `name` is `@amplitude/wizard`. Robust to file moves: previously the loop
 * was hard-coded to a fixed depth (`i < 5`), which had zero headroom after
 * extracting this helper from `src/lib/wizard-tools.ts` to
 * `src/lib/wizard-tools/bundled-skills.ts` (one directory deeper). Any
 * future move under `src/` would silently fall through.
 */
function getSkillsRootDir(): string {
  // Defensive upper bound: a sane repo is far shallower than this. Used as
  // a guard against pathological filesystems (e.g. a runaway symlink loop)
  // rather than a real depth budget.
  const MAX_DEPTH = 32;
  let dir = __dirname;
  for (let i = 0; i < MAX_DEPTH; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
          name?: string;
        };
        if (pkg.name === '@amplitude/wizard') {
          return path.join(dir, 'skills');
        }
      } catch {
        // Unreadable / malformed package.json — keep walking.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: relative to cwd. Preserves prior behavior when running from
  // a layout that doesn't contain the wizard's package.json (e.g. some
  // bundler outputs or tests).
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
 * Strict skill-id allowlist: lowercase alphanumeric with hyphens, underscores,
 * or dots. Used to gate any path.join with a skillId so a hostile or malformed
 * id can never escape the skills root via traversal characters (`..`, `/`).
 *
 * The dot is permitted to support version-suffix style ids like
 * `integration-nuxt-3.6` — without it, the bundled menu surfaces those
 * skills but `load_skill` / `bundledSkillExists` reject them, causing a
 * runtime failure when the agent tries to load one.
 *
 * Path-traversal patterns (`..`, `/`, `\`) and ids that start or end with
 * a separator-like character (`.`, `-`) are rejected by {@link isSafeSkillId},
 * not by the regex alone.
 */
const SKILL_ID_ALLOWLIST = /^[a-z0-9][a-z0-9_.-]*$/;

/**
 * Validate a skill id is safe to use with `path.join` against the skills
 * root. Combines the {@link SKILL_ID_ALLOWLIST} regex with a
 * defense-in-depth check that rejects:
 *  - consecutive dots (`..`) anywhere in the id
 *  - forward or backslash separators (`/`, `\`)
 *  - ids that end with `.` or `-` (the regex already rejects leading dots
 *    and dashes via the first character class)
 *
 * The dot is intentionally allowed *inside* the id (e.g. `nuxt-3.6`) but
 * never as the first or last character, and never as a `..` sequence.
 */
export function isSafeSkillId(skillId: string): boolean {
  if (typeof skillId !== 'string') return false;
  if (!SKILL_ID_ALLOWLIST.test(skillId)) return false;
  if (skillId.includes('..')) return false;
  if (skillId.includes('/') || skillId.includes('\\')) return false;
  // Trailing separator-like characters are rejected; leading ones are
  // already filtered by the first character class in the regex.
  const last = skillId[skillId.length - 1];
  if (last === '.' || last === '-') return false;
  return true;
}

/**
 * Strict reference path allowlist: only `references/<basename>.md` is
 * allowed, where the basename is restricted to word characters, hyphens,
 * and dots. Prevents traversal escapes from the skill directory.
 */
export const SKILL_REFERENCE_REL_PATH = /^references\/[\w.-]+\.md$/;

/**
 * Check whether a bundled skill exists on disk by searching across all
 * category subdirectories under skills/. Used to decide whether to pre-stage
 * a skill before the agent runs vs leave integration entry to the agent
 * prompt's on-disk discovery path (`Glob` under `.claude/skills/` — the
 * wizard-tools skill menu tools stay disabled).
 */
export function bundledSkillExists(skillId: string): boolean {
  // Reject any skillId that's not a strict basename — defense in depth before
  // the path.join below (skillId comes from internal callers but we treat it
  // as untrusted at the boundary).
  if (!isSafeSkillId(skillId)) return false;
  const skillsRoot = getSkillsRootDir();
  try {
    for (const category of fs.readdirSync(skillsRoot)) {
      // Same defense for category names read off disk.
      if (!isSafeSkillId(category)) continue;
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
 * Read bundled `SKILL.md` body for tiered-context experiments (never writes
 * to `.claude/skills/`). Returns null when absent or malformed inputs.
 */
export function readBundledSkillBody(skillId: string): string | null {
  if (!isSafeSkillId(skillId)) return null;
  const skillsRoot = getSkillsRootDir();
  try {
    for (const category of fs.readdirSync(skillsRoot)) {
      if (!isSafeSkillId(category)) continue;
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      const candidate = path.join(skillsRoot, category, skillId);
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      const skillMd = path.join(candidate, 'SKILL.md');
      if (
        fs.existsSync(candidate) &&
        fs.statSync(candidate).isDirectory() &&
        fs.existsSync(skillMd)
      ) {
        return fs.readFileSync(skillMd, 'utf8');
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Read a bundled skill reference markdown file by relative path.
 * Path is restricted to `references/*.md` to avoid broad file reads.
 */
export function readBundledSkillReference(
  skillId: string,
  refPath: string,
): string | null {
  if (!isSafeSkillId(skillId)) return null;
  if (!SKILL_REFERENCE_REL_PATH.test(refPath)) return null;
  const skillsRoot = getSkillsRootDir();
  try {
    for (const category of fs.readdirSync(skillsRoot)) {
      if (!isSafeSkillId(category)) continue;
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      const candidate = path.join(skillsRoot, category, skillId);
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      const reference = path.join(candidate, refPath);
      if (
        fs.existsSync(candidate) &&
        fs.statSync(candidate).isDirectory() &&
        fs.existsSync(reference)
      ) {
        return fs.readFileSync(reference, 'utf8');
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * The deterministic set of skills the wizard cares about pre-staging when
 * tiers are off. Exported so tests can lock the contract and the menu
 * writer can iterate without duplicating the list.
 *
 * Order is documentation-only: each id corresponds to a folder under
 * `skills/<category>/<id>/`. `bundledSkillExists` rejects ids that aren't
 * actually bundled.
 */
export const PRE_STAGED_CONSTANT_SKILLS = [
  'wizard-prompt-supplement',
  'amplitude-quickstart-taxonomy-agent',
  'add-analytics-instrumentation',
  // Pre-staged so the agent can load it via the Skill tool BEFORE
  // confirm_event_plan to detect existing analytics wrappers / helpers
  // / hooks in the codebase. Without this, the agent reimplements
  // events on top of the raw SDK and ignores the wrappers customers
  // already use (Lendi feedback — see the corresponding commandment
  // in `commandments.ts`). Referenced by the `instrument-events` and
  // `discover-event-surfaces` skills as well, so pre-staging avoids
  // a missing-skill error if those sub-skills run.
  'discover-analytics-patterns',
  // `amplitude-chart-dashboard-plan` is intentionally NOT pre-staged for
  // the main run — chart and dashboard creation moved to the deferred
  // `amplitude-wizard dashboard` command in DEFER_DASHBOARD_PLAN PR 4.
  // The deferred command loads the skill explicitly when it runs (see
  // `src/commands/dashboard.ts`). The skill source still lives under
  // `skills/taxonomy/` so it can be resolved at that time.
] as const;

/**
 * Build the Tier-1 menu payload from the bundled skills directory. The
 * shape matches the JSON the `load_skill_menu` MCP tool returns, so the
 * file written to `.claude/skills/skill-menu.json` is interchangeable
 * with the tool response.
 */
export function buildSkillMenuFileContent(): SkillMenuFileContent {
  const menu = loadBundledSkillMenu();
  return {
    categories: Object.fromEntries(
      Object.entries(menu.categories).map(([name, entries]) => [
        name,
        entries.map((s) => ({ id: s.id, name: s.name })),
      ]),
    ),
  };
}

/**
 * Write the Tier-1 menu to `<installDir>/.claude/skills/skill-menu.json`.
 *
 * Returns the absolute path on success. On error logs and returns null —
 * the caller falls back to the in-prompt menu so a write failure never
 * blocks the run.
 */
export function writeSkillMenuFile(installDir: string): string | null {
  const skillsDir = path.join(installDir, '.claude', 'skills');
  const menuPath = path.join(skillsDir, SKILL_MENU_FILENAME);
  try {
    fs.mkdirSync(skillsDir, { recursive: true });
    const content = buildSkillMenuFileContent();
    fs.writeFileSync(menuPath, JSON.stringify(content, null, 2), 'utf8');
    logToFile(`writeSkillMenuFile: wrote ${menuPath}`);
    return menuPath;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToFile(`writeSkillMenuFile: failed: ${msg}`);
    return null;
  }
}

/**
 * Pre-stage skills for the agent run.
 *
 * Two modes:
 *
 * - **Tiered (default — `AMPLITUDE_WIZARD_SKILL_TIERS` unset or `'1'`):**
 *   Writes a single Tier-1 menu file at `.claude/skills/skill-menu.json`
 *   containing `{ id, name }` per skill. Skill bodies stay in the wizard
 *   package and are served on-demand via the `load_skill` /
 *   `load_skill_reference` MCP tools. This is the default rollout per
 *   the perf-skill-tiers audit (~47K eager skill-body tokens removed
 *   from the cold-start prefix).
 *
 * - **Eager (opt-out — `AMPLITUDE_WIZARD_SKILL_TIERS=0`):**
 *   Copies the constant skills (taxonomy + instrumentation + dashboard)
 *   plus the resolved integration skill into `.claude/skills/<id>/`.
 *   Preserves the previous behaviour exactly; useful for debugging or
 *   for users who hit a tier-mode regression.
 *
 * Returns the list of skill IDs that were successfully staged. In tiered
 * mode the list is empty (the menu is the only artifact written) but
 * `integrationStaged` still reflects whether the resolver found a
 * matching integration skill — callers use that signal to decide
 * whether the prompt can pin a specific id.
 */
export function preStageSkills(
  installDir: string,
  integrationSkillId: string | null,
): { staged: string[]; integrationStaged: boolean } {
  if (isSkillTiersEnabled()) {
    // Tiered mode: write only the menu. Skill bodies are served by the
    // `load_skill` / `load_skill_reference` MCP tools at runtime.
    writeSkillMenuFile(installDir);
    const integrationStaged = Boolean(
      integrationSkillId && bundledSkillExists(integrationSkillId),
    );
    logToFile(
      `preStageSkills: tiered mode (menu only); integrationSkillId=${
        integrationSkillId ?? 'null'
      } resolved=${integrationStaged}`,
    );
    return { staged: [], integrationStaged };
  }

  // Eager mode (opt-out): preserve the legacy pre-stage behaviour.
  const staged: string[] = [];
  for (const id of PRE_STAGED_CONSTANT_SKILLS) {
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
  logToFile(`preStageSkills: eager mode staged [${staged.join(', ')}]`);
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
