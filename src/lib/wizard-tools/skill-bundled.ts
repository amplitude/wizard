/**
 * Bundled skills menu (ships under repo `skills/`). Phase E split from wizard-tools.
 */
import path from 'path';
import fs from 'fs';

import { logToFile } from '../../utils/debug.js';
import type { SkillEntry, SkillMenu } from './skill-remote.js';

/**
 * Bundled `skills/` repo root (integration, instrumentation, …).
 * Exported for `wizard-tools.ts` path helpers that stay in the main module.
 *
 * Walk up to the nearest `package.json` for `@amplitude/wizard` and resolve
 * `skills/` relative to that. Falls back to a bounded parent walk that looks
 * for any sibling `skills/` directory. We avoid `process.cwd()` because
 * that's the user's project — a `skills/` dir there would silently shadow
 * the bundled one.
 */
export function getBundledSkillsRootDir(): string {
  // 1. Find the wizard package root (closest package.json with the right name).
  let dir = __dirname;
  for (let i = 0; i < 12; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
          name?: string;
        };
        if (pkg.name === '@amplitude/wizard') {
          const skillsRoot = path.join(dir, 'skills');
          if (fs.existsSync(skillsRoot)) return skillsRoot;
        }
      } catch {
        // ignore unreadable package.json and keep walking
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 2. Fallback: bounded parent walk for a sibling `skills/` directory.
  // Bumped from 5 to 6 levels because skill-bundled.ts now lives one level
  // deeper than the original wizard-tools.ts location.
  dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'skills'))) {
      return path.join(dir, 'skills');
    }
    dir = path.dirname(dir);
  }
  // 3. Last-ditch fallback. Logged so deeply nested monorepos can spot it.
  logToFile(
    `getBundledSkillsRootDir: package.json walk failed; falling back to cwd ${process.cwd()}`,
  );
  return path.join(process.cwd(), 'skills');
}

/**
 * Build skill menu from bundled skill directories.
 * Scans skills/<category>/ subdirectories for folders containing SKILL.md.
 * Each subdirectory of skills/ becomes a category (e.g. integration, instrumentation).
 */
export function loadBundledSkillMenu(): SkillMenu {
  const skillsRoot = getBundledSkillsRootDir();
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
