/**
 * Deterministic selection of a single integration-* skill when multiple
 * .claude/skills/integration-* directories with SKILL.md could exist on disk
 * (e.g. leftovers from prior runs, or staging failed while directories remain).
 *
 * The agent prompt must not rely on the model to pick among several matches.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Integration } from './constants.js';

/** Same rule as wizard-tools — basename-safe skill ids only. */
const SKILL_ID_ALLOWLIST = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Lists integration skill directory names under `.claude/skills/` that contain
 * a SKILL.md file. Sorted lexicographically for stable iteration.
 */
export function listIntegrationSkillIdsOnDisk(installDir: string): string[] {
  const root = path.join(installDir, '.claude', 'skills');
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (!ent.name.startsWith('integration-')) continue;
    if (!SKILL_ID_ALLOWLIST.test(ent.name)) continue;
    const skillMd = path.join(root, ent.name, 'SKILL.md');
    if (fs.existsSync(skillMd)) out.push(ent.name);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

/**
 * Narrow disk candidates to ids that plausibly belong to the active wizard
 * integration. When nothing matches (odd disk state), the resolver falls back
 * to the full disk list so we can still pick a deterministic winner.
 *
 * @see {@link resolveIntegrationSkillId} — TODO(PM): tighten react-router /
 * TanStack overlap (file-based vs code-based) when we have explicit user or
 * package signals beyond `routerMode`.
 */
export function filterIntegrationSkillIdsForIntegration(
  integration: string,
  diskIds: readonly string[],
): string[] {
  const exact = `integration-${integration}`;
  const prefix = `${exact}-`;
  const byEnum = diskIds.filter((id) => id === exact || id.startsWith(prefix));
  if (byEnum.length > 0) return [...byEnum].sort((a, b) => a.localeCompare(b));

  // `Integration.reactRouter` serializes as `react-router`, but bundled ids
  // use `integration-react-react-router-*` / `integration-react-tanstack-router-*`
  // / `integration-tanstack-start`.
  if (integration === 'react-router') {
    const rr = diskIds.filter(
      (id) =>
        id.startsWith('integration-react-react-router-') ||
        id.startsWith('integration-react-tanstack-router-') ||
        id === 'integration-tanstack-start',
    );
    if (rr.length > 0) return [...rr].sort((a, b) => a.localeCompare(b));
  }

  return [];
}

const NEXT_ROUTER_TO_SKILL: Record<string, string> = {
  'app-router': 'integration-nextjs-app-router',
  'pages-router': 'integration-nextjs-pages-router',
};

const REACT_ROUTER_MODE_TO_SKILL: Record<string, string> = {
  v6: 'integration-react-react-router-6',
  'v7-framework': 'integration-react-react-router-7-framework',
  'v7-data': 'integration-react-react-router-7-data',
  'v7-declarative': 'integration-react-react-router-7-declarative',
};

export type ResolveIntegrationSkillContext = {
  /** Active framework integration (metadata.integration). */
  integration: Integration | string;
  /**
   * Bundled id from `getIntegrationSkillId` / `integration-${integration}`
   * fallback — preferred when it exists on disk (covers staging failure with
   * a prior successful copy).
   */
  primaryBundledId: string | null;
  /** Same object passed to `buildIntegrationPrompt` / analytics. */
  frameworkContext: Record<string, unknown>;
  /** Output of {@link listIntegrationSkillIdsOnDisk} for this installDir. */
  candidateSkillIds: readonly string[];
};

export type ResolveIntegrationSkillIdSource =
  | 'primary_on_disk'
  | 'framework_hint'
  | 'single_candidate'
  | 'lexicographic_tiebreak';

export type ResolveIntegrationSkillIdResult = {
  skillId: string;
  source: ResolveIntegrationSkillIdSource;
} | null;

/**
 * Pick exactly one `integration-*` skill id from on-disk candidates.
 *
 * Rules (in order):
 * 1. **Primary** — If `primaryBundledId` is in the scoped candidate pool, use it.
 * 2. **Framework hints** — Next.js `context.router` and React Router
 *    `context.routerMode` map to their bundled skill ids when present in the pool.
 * 3. **Single candidate** — If the scoped pool has one id, return it.
 * 4. **Lexicographic tie-break** — Sort the scoped pool (UTF-16, `localeCompare`)
 *    and take the first entry. Caller should log when `source` is
 *    `lexicographic_tiebreak` (possible mis-stale skills on disk).
 *
 * Scoping: {@link filterIntegrationSkillIdsForIntegration}; if that yields no
 * matches, the pool is the full sorted `candidateSkillIds` (conservative fallback).
 *
 * @returns `null` if there are zero candidates on disk.
 */
export function resolveIntegrationSkillId(
  ctx: ResolveIntegrationSkillContext,
): ResolveIntegrationSkillIdResult {
  const allSorted = [...ctx.candidateSkillIds].sort((a, b) =>
    a.localeCompare(b),
  );
  if (allSorted.length === 0) return null;

  const integrationKey = String(ctx.integration);
  const scoped = filterIntegrationSkillIdsForIntegration(
    integrationKey,
    allSorted,
  );
  const pool = scoped.length > 0 ? scoped : allSorted;

  const primary = ctx.primaryBundledId;
  if (primary && pool.includes(primary)) {
    return { skillId: primary, source: 'primary_on_disk' };
  }

  const hinted = hintPreferredSkillId(
    integrationKey,
    ctx.frameworkContext,
    pool,
  );
  if (hinted) {
    return { skillId: hinted, source: 'framework_hint' };
  }

  if (pool.length === 1) {
    return { skillId: pool[0], source: 'single_candidate' };
  }

  const sortedPool = [...pool].sort((a, b) => a.localeCompare(b));
  return {
    skillId: sortedPool[0],
    source: 'lexicographic_tiebreak',
  };
}

function hintPreferredSkillId(
  integration: string,
  frameworkContext: Record<string, unknown>,
  pool: readonly string[],
): string | null {
  if (integration === 'nextjs') {
    const router = frameworkContext.router;
    if (typeof router === 'string') {
      const want = NEXT_ROUTER_TO_SKILL[router];
      if (want && pool.includes(want)) return want;
    }
  }

  if (integration === 'react-router') {
    const mode = frameworkContext.routerMode;
    if (typeof mode === 'string') {
      const want = REACT_ROUTER_MODE_TO_SKILL[mode];
      if (want && pool.includes(want)) return want;
    }
  }

  return null;
}
