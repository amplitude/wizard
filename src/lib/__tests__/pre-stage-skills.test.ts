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

    // These four were the original constant set before
    // discover-analytics-patterns joined. Verify they still ship so a
    // future edit to the constants list doesn't accidentally drop one.
    for (const id of [
      'wizard-prompt-supplement',
      'amplitude-quickstart-taxonomy-agent',
      'add-analytics-instrumentation',
      'amplitude-chart-dashboard-plan',
    ]) {
      expect(staged, `${id} fell out of preStageSkills`).toContain(id);
    }
  });
});
