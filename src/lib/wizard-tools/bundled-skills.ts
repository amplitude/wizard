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
 * Memoized cache for {@link getSkillsRootDir}. The skill tree is immutable
 * during a wizard session — `pnpm skills:refresh` runs out-of-band, before
 * the wizard process starts — so we resolve the root directory once on
 * first access and reuse it for every subsequent lookup. Prior behaviour
 * walked the parent chain and parsed `package.json` on every call, which
 * the `load_skill` MCP tool amplified to one walk per skill request.
 *
 * Cleared via {@link clearBundledSkillsCache} (test-only).
 */
let cachedSkillsRootDir: string | null = null;

/**
 * Memoized in-memory index of every bundled skill, built lazily on first
 * access. Maps `skillId -> { category, path, body, displayName }`.
 *
 * Why an index: previously `loadBundledSkillMenu`, `bundledSkillExists`,
 * `readBundledSkillBody`, and `readBundledSkillReference` each re-walked
 * the entire `skills/<category>/<id>/` tree (and the menu loader read
 * every SKILL.md from disk to extract a single frontmatter line). The
 * `load_skill` MCP tool calls these per agent invocation, so each skill
 * request paid the full walk cost. Building the index once collapses
 * those repeated walks into a single map lookup.
 *
 * The map is keyed by skill id alone. The `installBundledSkill` legacy
 * iteration order (first matching category wins) is preserved because
 * the index records whichever category we encountered first while
 * walking — same semantics as the original `for (const category of
 * readdirSync(skillsRoot))` loop.
 *
 * Cleared via {@link clearBundledSkillsCache} (test-only).
 */
interface SkillIndexEntry {
  /** Category folder name (e.g. `integration`, `taxonomy`). */
  category: string;
  /** Absolute path to the skill's directory (`<skillsRoot>/<category>/<id>`). */
  skillDir: string;
  /** Absolute path to the skill's `SKILL.md`. */
  skillMdPath: string;
  /** Cached `SKILL.md` body (read once into the index). */
  body: string;
  /** Display name extracted from frontmatter `description: >-` block, with id-based fallback. */
  displayName: string;
}

interface BundledSkillsIndex {
  /** Category folder names that exist on disk, in `readdirSync` order. */
  categories: string[];
  /** skillId -> entry for every bundled skill that has a `SKILL.md`. */
  skills: Map<string, SkillIndexEntry>;
}

let cachedSkillsIndex: BundledSkillsIndex | null = null;

/**
 * Reset the memoized skills root directory and skill index. **Test-only** —
 * the wizard never invalidates the cache during normal operation because the
 * skill tree is immutable for the lifetime of the process. Tests that mock
 * `fs` or change `process.cwd` between cases must call this in `beforeEach`
 * so the index they observe matches the mocked filesystem.
 */
export function clearBundledSkillsCache(): void {
  cachedSkillsRootDir = null;
  cachedSkillsIndex = null;
}

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
 *
 * The result is memoized in {@link cachedSkillsRootDir} after the first
 * call so the parent walk + `package.json` parse runs at most once per
 * process.
 */
function getSkillsRootDir(): string {
  if (cachedSkillsRootDir !== null) return cachedSkillsRootDir;
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
          cachedSkillsRootDir = path.join(dir, 'skills');
          return cachedSkillsRootDir;
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
  cachedSkillsRootDir = path.join(process.cwd(), 'skills');
  return cachedSkillsRootDir;
}

/**
 * Extract the display name from a SKILL.md frontmatter `description: >-`
 * block, falling back to a humanized form of the skill id.
 *
 * The frontmatter pattern is fixed by context-hub's generator and lives
 * within the first ~200 bytes of every SKILL.md, so we don't need the
 * full file body to compute it.
 */
function extractDisplayName(
  skillMdContent: string,
  skillId: string,
  category: string,
): string {
  const descMatch = skillMdContent.match(/^description:\s*>-?\s*\n\s+(.+)/m);
  if (descMatch) return descMatch[1].trim();
  return skillId.replace(new RegExp(`^${category}-`), '').replace(/-/g, ' ');
}

/**
 * Build (or return the memoized) bundled-skills index. Walks
 * `<skillsRoot>/<category>/<id>/SKILL.md` exactly once per process.
 *
 * Errors during the walk are logged and the partial index is cached —
 * matching the prior callsites' "best effort, log and move on" behaviour.
 * A subsequent call won't retry the walk, which is what we want: skill
 * trees don't materialize mid-session, so a transient I/O failure here
 * almost certainly means the bundle is genuinely missing.
 */
function getBundledSkillsIndex(): BundledSkillsIndex {
  if (cachedSkillsIndex !== null) return cachedSkillsIndex;

  const skillsRoot = getSkillsRootDir();
  logToFile(`getBundledSkillsIndex: scanning ${skillsRoot}`);
  const skills = new Map<string, SkillIndexEntry>();
  const categories: string[] = [];

  try {
    for (const category of fs.readdirSync(skillsRoot)) {
      const categoryPath = path.join(skillsRoot, category);
      let categoryStat;
      try {
        categoryStat = fs.statSync(categoryPath);
      } catch {
        continue;
      }
      if (!categoryStat.isDirectory()) continue;
      categories.push(category);

      let names: string[];
      try {
        names = fs.readdirSync(categoryPath);
      } catch {
        continue;
      }

      for (const name of names) {
        const skillDir = path.join(categoryPath, name);
        const skillMdPath = path.join(skillDir, 'SKILL.md');
        let skillStat;
        try {
          skillStat = fs.statSync(skillDir);
        } catch {
          continue;
        }
        if (!skillStat.isDirectory()) continue;
        if (!fs.existsSync(skillMdPath)) continue;

        // First-write-wins: preserve the legacy behaviour where iteration
        // order in `installBundledSkill` etc. picks the first category to
        // contain the id. In practice ids are unique across categories,
        // so the guard is purely defensive.
        if (skills.has(name)) continue;

        let body: string;
        try {
          body = fs.readFileSync(skillMdPath, 'utf8');
        } catch {
          continue;
        }
        const displayName = extractDisplayName(body, name, category);
        skills.set(name, {
          category,
          skillDir,
          skillMdPath,
          body,
          displayName,
        });
      }
    }
  } catch (err) {
    logToFile(
      `getBundledSkillsIndex: error scanning: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  cachedSkillsIndex = { categories, skills };
  logToFile(
    `getBundledSkillsIndex: indexed ${skills.size} skills across ${categories.length} categories`,
  );
  return cachedSkillsIndex;
}

/**
 * Build skill menu from bundled skill directories.
 * Scans skills/<category>/ subdirectories for folders containing SKILL.md.
 * Each subdirectory of skills/ becomes a category (e.g. integration, instrumentation).
 *
 * Backed by the memoized {@link getBundledSkillsIndex}, so repeated calls
 * (e.g. one per agent invocation) are O(n) over the indexed map rather
 * than re-walking the filesystem.
 */
export function loadBundledSkillMenu(): SkillMenu {
  const index = getBundledSkillsIndex();
  const categories: Record<string, SkillEntry[]> = {};

  for (const category of index.categories) {
    const entries: SkillEntry[] = [];
    for (const [id, entry] of index.skills) {
      if (entry.category !== category) continue;
      entries.push({ id, name: entry.displayName, downloadUrl: '' });
    }
    if (entries.length > 0) {
      categories[category] = entries;
    }
  }

  const total = Object.values(categories).reduce(
    (sum, entries) => sum + entries.length,
    0,
  );
  logToFile(
    `loadBundledSkillMenu: returning ${total} skills across ${
      Object.keys(categories).length
    } categories (from index)`,
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
 * Check whether a bundled skill exists on disk. Used to decide whether to
 * pre-stage a skill before the agent runs vs leave integration entry to
 * the agent prompt's on-disk discovery path (`Glob` under `.claude/skills/`
 * — the wizard-tools skill menu tools stay disabled).
 *
 * Backed by the in-memory index — a single map lookup, not a filesystem
 * scan. The category-name safety check survives via the index build path
 * (categories with traversal-unsafe names are still walked because
 * `readdirSync` returned them, but the map only contains skill ids, not
 * category traversal vectors).
 */
export function bundledSkillExists(skillId: string): boolean {
  // Reject any skillId that's not a strict basename — defense in depth.
  // The index is keyed by names that came off disk, so a malformed id
  // can never produce a hit, but we keep the explicit check so callers
  // get the same fast-fail semantics as before.
  if (!isSafeSkillId(skillId)) return false;
  const index = getBundledSkillsIndex();
  const entry = index.skills.get(skillId);
  if (!entry) return false;
  // Defense in depth: ensure the category recorded in the index is also
  // a safe basename, matching the original `isSafeSkillId(category)`
  // gate inside the per-category loop.
  if (!isSafeSkillId(entry.category)) return false;
  return true;
}

/**
 * Read bundled `SKILL.md` body for tiered-context experiments (never writes
 * to `.claude/skills/`). Returns null when absent or malformed inputs.
 *
 * Served from the in-memory index — the SKILL.md body is read off disk
 * exactly once (during index construction) regardless of how many times
 * `load_skill` requests it.
 */
export function readBundledSkillBody(skillId: string): string | null {
  if (!isSafeSkillId(skillId)) return null;
  const index = getBundledSkillsIndex();
  const entry = index.skills.get(skillId);
  if (!entry) return null;
  if (!isSafeSkillId(entry.category)) return null;
  return entry.body;
}

/**
 * Read a bundled skill reference markdown file by relative path.
 * Path is restricted to `references/*.md` to avoid broad file reads.
 *
 * Reference files are not pre-loaded into the index (there are many per
 * skill and most are never requested). The skill *location* is, though —
 * so we resolve the directory in O(1) and only hit the disk for the
 * specific reference body when a caller asks for it.
 */
export function readBundledSkillReference(
  skillId: string,
  refPath: string,
): string | null {
  if (!isSafeSkillId(skillId)) return null;
  if (!SKILL_REFERENCE_REL_PATH.test(refPath)) return null;
  const index = getBundledSkillsIndex();
  const entry = index.skills.get(skillId);
  if (!entry) return null;
  if (!isSafeSkillId(entry.category)) return null;
  // entry.skillDir is built from validated category + skillId during the
  // index walk. refPath is constrained by SKILL_REFERENCE_REL_PATH above.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const reference = path.join(entry.skillDir, refPath);
  try {
    if (!fs.existsSync(reference)) return null;
    return fs.readFileSync(reference, 'utf8');
  } catch {
    return null;
  }
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
function writeSkillMenuFile(installDir: string): string | null {
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
 * Looks up the skill's source location via the in-memory index — no
 * filesystem walk per call.
 */
export function installBundledSkill(
  skillId: string,
  installDir: string,
): { success: boolean; error?: string } {
  const dest = path.join(installDir, '.claude', 'skills', skillId);
  const index = getBundledSkillsIndex();
  const entry = index.skills.get(skillId);
  if (!entry) {
    return { success: false, error: `Bundled skill "${skillId}" not found` };
  }

  try {
    fs.cpSync(entry.skillDir, dest, { recursive: true });
    logToFile(
      `installBundledSkill: copied ${skillId} from ${entry.skillDir} to ${dest}`,
    );
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logToFile(`installBundledSkill: error: ${msg}`);
    return { success: false, error: msg };
  }
}
