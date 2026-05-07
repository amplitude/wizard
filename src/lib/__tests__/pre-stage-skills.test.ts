/**
 * preStageSkills — locks the deterministic set of skills the wizard
 * pre-stages into the user's `.claude/skills/` directory before the
 * agent runs.
 *
 * Pre-staging matters: the agent loads skills via the Skill tool by
 * filesystem path (`.claude/skills/<id>/SKILL.md`), and `load_skill_menu`
 * / `install_skill` are intentionally disabled on the wizard-tools
 * server. If a skill isn't pre-staged, the agent can't load it without
 * tripping a fallback. So the constants list IS the wizard's contract
 * with the agent's prompt — every skill the prompt references by id
 * must appear here, and removing one is a quiet way to break the
 * agent's workflow at runtime.
 *
 * The `discover-analytics-patterns` entry was added in response to
 * Lendi's feedback (Jamie Lim) — without it pre-staged, the agent
 * couldn't load the wrapper-detection skill and reimplemented every
 * event on top of the raw SDK, ignoring the codebase's existing
 * `trackEvent()` wrapper. Lock the entry in.
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
import os from 'os';
import fs from 'fs';
import {
  preStageSkills,
  bundledSkillExists,
} from '../wizard-tools/bundled-skills';

describe('preStageSkills', () => {
  let installDir: string;

  beforeEach(() => {
    installDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'wizard-prestage-test-'),
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(installDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
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
