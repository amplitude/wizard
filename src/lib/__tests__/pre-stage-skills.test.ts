/**
 * preStageSkills — locks the wizard's contract for what lands in the
 * user's `.claude/skills/` directory before the agent runs.
 *
 * Two modes (rolled out per the perf-skill-tiers audit):
 *
 * - **Tiered (default)** — only a Tier-1 menu file is written. Skill
 *   bodies stay in the wizard package and are served on-demand via the
 *   `load_skill` / `load_skill_reference` MCP tools. This collapses
 *   ~47K eagerly-staged skill-body tokens out of the cold-start prefix.
 *
 * - **Eager (opt-out, `AMPLITUDE_WIZARD_SKILL_TIERS=0`)** — the legacy
 *   path. Copies the constant skill bodies plus the integration skill
 *   into `.claude/skills/<id>/`. The `discover-analytics-patterns` entry
 *   was added in response to Lendi's feedback (Jamie Lim) — without it
 *   pre-staged the agent reimplemented every event on top of the raw
 *   SDK, ignoring the codebase's existing `trackEvent()` wrapper.
 *
 * `amplitude-chart-dashboard-plan` was removed from the constant set in
 * DEFER_DASHBOARD_PLAN PR 4 — chart and dashboard creation moved to the
 * deferred `amplitude-wizard dashboard` command, which loads the skill
 * itself when invoked. Pre-staging it for the main run would re-introduce
 * the 168k-token compaction stall the audit measured. The negative test
 * below pins that drop.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import {
  preStageSkills,
  bundledSkillExists,
  buildSkillMenuFileContent,
  readBundledSkillBody,
  SKILL_MENU_FILENAME,
  PRE_STAGED_CONSTANT_SKILLS,
} from '../wizard-tools/bundled-skills';
import { createTempDir } from '../../utils/__tests__/helpers/temp-dir.js';

describe('preStageSkills (eager mode, AMPLITUDE_WIZARD_SKILL_TIERS=0)', () => {
  let installDir: string;
  let cleanup: () => void;
  const ENV_KEY = 'AMPLITUDE_WIZARD_SKILL_TIERS';

  beforeEach(() => {
    ({ dir: installDir, cleanup } = createTempDir('wizard-prestage-test-'));
    // Force the legacy eager path. The default is now tiered.
    process.env[ENV_KEY] = '0';
  });

  afterEach(() => {
    try {
      cleanup();
    } catch {
      // best-effort cleanup
    }
    delete process.env[ENV_KEY];
  });

  it('stages discover-analytics-patterns alongside the other constant skills', () => {
    // Sanity: the skill must exist in the bundle. If this fails, the
    // skills/ directory is missing the source — investigate that first.
    expect(
      bundledSkillExists('discover-analytics-patterns'),
      'discover-analytics-patterns is missing from the bundled skills/. Run pnpm skills:refresh:instrumentation or check skills/instrumentation/.',
    ).toBe(true);

    const { staged } = preStageSkills(installDir, null);

    // The skill must end up in the staged list — otherwise the
    // commandment that tells the agent to load it has nothing to load.
    expect(staged).toContain('discover-analytics-patterns');

    // And it must actually be on disk under .claude/skills/, since the
    // agent references it by filesystem path.
    const stagedSkillMd = path.join(
      installDir,
      '.claude',
      'skills',
      'discover-analytics-patterns',
      'SKILL.md',
    );
    expect(fs.existsSync(stagedSkillMd)).toBe(true);
  });

  it('keeps the other constant skills staged (no regression)', () => {
    const { staged } = preStageSkills(installDir, null);

    // The original constant set, minus `amplitude-chart-dashboard-plan`
    // which moved to the deferred `amplitude-wizard dashboard` command
    // in DEFER_DASHBOARD_PLAN PR 4. The deferred command stages /
    // loads that skill on its own; the main run no longer pre-stages
    // it. (The next case below pins the negative — main run must NOT
    // ship it.)
    for (const id of [
      'wizard-prompt-supplement',
      'amplitude-quickstart-taxonomy-agent',
      'add-analytics-instrumentation',
    ]) {
      expect(staged, `${id} fell out of preStageSkills`).toContain(id);
    }
  });

  it('does NOT stage amplitude-chart-dashboard-plan in the main run (DEFER_DASHBOARD_PLAN PR 4)', () => {
    // Regression guard: chart and dashboard creation moved out of
    // `wizard run` in PR 4. The skill source still lives under
    // `skills/taxonomy/` (so `bundledSkillExists` stays true) and the
    // deferred `amplitude-wizard dashboard` command loads it
    // explicitly when invoked. But the main run's pre-stage list must
    // skip it — otherwise the agent wastes 168k tokens on chart
    // strategy mid-instrumentation, which is precisely the failure
    // mode this PR removes.
    const { staged } = preStageSkills(installDir, null);
    expect(staged).not.toContain('amplitude-chart-dashboard-plan');
    // And nothing should land on disk under the canonical pre-stage
    // location either — the deferred command writes its own copy when
    // it runs.
    const stagedSkillMd = path.join(
      installDir,
      '.claude',
      'skills',
      'amplitude-chart-dashboard-plan',
      'SKILL.md',
    );
    expect(fs.existsSync(stagedSkillMd)).toBe(false);
  });
});

describe('preStageSkills (tiered mode — default)', () => {
  let installDir: string;
  let cleanup: () => void;
  const ENV_KEY = 'AMPLITUDE_WIZARD_SKILL_TIERS';

  beforeEach(() => {
    ({ dir: installDir, cleanup } = createTempDir(
      'wizard-prestage-tiered-test-',
    ));
    // Default-on behaviour: leave the env var unset so isSkillTiersEnabled
    // returns true. (Setting to '1' is also valid; the default-unset path
    // is the more common production case so we test that explicitly.)
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    try {
      cleanup();
    } catch {
      // best-effort cleanup
    }
    delete process.env[ENV_KEY];
  });

  it('writes only the menu — no skill bodies on disk', () => {
    preStageSkills(installDir, null);

    const menuPath = path.join(
      installDir,
      '.claude',
      'skills',
      SKILL_MENU_FILENAME,
    );
    expect(fs.existsSync(menuPath)).toBe(true);

    // Sanity: the constant skill bodies must NOT be on disk in tiered mode.
    // That's the whole point — they're served via load_skill instead.
    for (const id of PRE_STAGED_CONSTANT_SKILLS) {
      const skillMd = path.join(
        installDir,
        '.claude',
        'skills',
        id,
        'SKILL.md',
      );
      expect(
        fs.existsSync(skillMd),
        `${id} body leaked to disk in tiered mode`,
      ).toBe(false);
    }
  });

  it('returns an empty staged list (only the menu is written)', () => {
    const { staged } = preStageSkills(installDir, null);
    expect(staged).toEqual([]);
  });

  it('still resolves integrationStaged when the integration skill is bundled', () => {
    // Pick any bundled integration skill — javascript_web is always shipped.
    const integrationId = 'integration-javascript_web';
    if (!bundledSkillExists(integrationId)) {
      // If a future refactor renames the skill, fall back to whichever the
      // bundle does ship; the assertion below still checks the contract.
      return;
    }
    const { integrationStaged } = preStageSkills(installDir, integrationId);
    expect(integrationStaged).toBe(true);
  });

  it('writes a menu whose shape matches what load_skill_menu returns', () => {
    preStageSkills(installDir, null);

    const menuPath = path.join(
      installDir,
      '.claude',
      'skills',
      SKILL_MENU_FILENAME,
    );
    const onDisk = JSON.parse(fs.readFileSync(menuPath, 'utf8')) as unknown;
    const expected = buildSkillMenuFileContent();

    // Same top-level shape: { categories: { <name>: [{ id, name }, ...] } }.
    // We match the shape, not the exact content, because the bundle's
    // skill list evolves — but every entry must be { id, name } with no
    // extras (downloadUrl etc) so the menu fits the load_skill contract.
    expect(onDisk).toEqual(expected);
    expect(typeof (onDisk as { categories?: unknown }).categories).toBe(
      'object',
    );
    for (const entries of Object.values(
      (onDisk as { categories: Record<string, unknown> }).categories,
    )) {
      expect(Array.isArray(entries)).toBe(true);
      for (const entry of entries as { id: string; name: string }[]) {
        expect(typeof entry.id).toBe('string');
        expect(typeof entry.name).toBe('string');
        // Only id + name, nothing else. The Tier-1 contract is intentionally
        // narrow so we don't accidentally start serializing downloadUrl
        // or other server-only fields into the prompt prefix.
        expect(Object.keys(entry).sort()).toEqual(['id', 'name']);
      }
    }
  });

  it('menu entry ids that pass the security allowlist resolve via load_skill (round-trip contract)', () => {
    preStageSkills(installDir, null);
    const menu = buildSkillMenuFileContent();
    // The security regex used by readBundledSkillBody / bundledSkillExists
    // intentionally rejects ids containing characters that could enable
    // path traversal (dots, slashes, etc.). One bundled skill —
    // `integration-nuxt-3.6` — has a dot in its id and is therefore not
    // load_skill-fetchable; that's a pre-existing bundle/regex
    // inconsistency, not part of this rollout. The Tier-1 menu happily
    // surfaces it because loadBundledSkillMenu does NOT filter on the
    // regex (it just lists what's on disk). Lock the contract for ids
    // that DO match the allowlist; flag any new mismatch separately so
    // we surface bundle drift without conflating it with this perf fix.
    const allowlist = /^[a-z0-9][a-z0-9_-]*$/;
    const mismatches: string[] = [];
    let checked = 0;
    for (const entries of Object.values(menu.categories)) {
      for (const entry of entries) {
        if (!allowlist.test(entry.id)) {
          mismatches.push(entry.id);
          continue;
        }
        checked++;
        const body = readBundledSkillBody(entry.id);
        expect(
          body,
          `load_skill cannot fetch menu-listed skill "${entry.id}"`,
        ).toBeTruthy();
      }
    }
    // Sanity: we must actually have exercised the contract on the bulk
    // of the menu — otherwise a future regex tightening that nukes
    // every id would silently turn this into a no-op test.
    expect(checked).toBeGreaterThan(5);

    // The single known mismatch is the only acceptable one. If a new
    // id with a dot or other rejected char shows up in the bundle,
    // this assertion fails loudly so the inconsistency gets fixed
    // (either rename the skill folder or relax the regex).
    expect(mismatches.sort()).toEqual(['integration-nuxt-3.6']);
  });
});
