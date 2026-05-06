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
// Bundled skill helpers
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
 * a skill before the agent runs vs leave integration entry to the agent
 * prompt's on-disk discovery path (`Glob` under `.claude/skills/` — the
 * wizard-tools skill menu tools stay disabled).
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
    'wizard-prompt-supplement',
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
