/**
 * bundled-skills index — locks the contract that the skill tree is walked
 * exactly once per process.
 *
 * Before this PR, every public helper (`loadBundledSkillMenu`,
 * `bundledSkillExists`, `readBundledSkillBody`, `readBundledSkillReference`,
 * `installBundledSkill`) re-walked `<skillsRoot>/<category>/<id>/` from
 * scratch on each call. The `load_skill` MCP tool calls these per agent
 * invocation, so a single wizard run paid the walk cost dozens of times.
 *
 * The fix: build a single in-memory index on first access and serve every
 * subsequent lookup from the map. This test counts `readdirSync` /
 * `readFileSync` calls against the bundled skills root and asserts the
 * walk happens at most once across many calls.
 *
 * If you find yourself wanting to remove this test because it's "flaky",
 * the right fix is almost certainly to keep the cache and tighten the
 * call-site assertion — not to nuke the test. The pattern this guards
 * against (per-call filesystem walks under `load_skill`) is a real perf
 * regression that the audit caught.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  bundledSkillExists,
  clearBundledSkillsCache,
  installBundledSkill,
  loadBundledSkillMenu,
  readBundledSkillBody,
  readBundledSkillReference,
} from '../bundled-skills';

describe('bundled-skills in-memory index', () => {
  let readdirSpy: ReturnType<typeof vi.spyOn>;
  let readFileSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Drop any state cached by other test files in this process. The
    // wizard never calls clearBundledSkillsCache during normal operation,
    // but tests rely on it to observe a clean call count.
    clearBundledSkillsCache();
    readdirSpy = vi.spyOn(fs, 'readdirSync');
    readFileSpy = vi.spyOn(fs, 'readFileSync');
  });

  afterEach(() => {
    readdirSpy.mockRestore();
    readFileSpy.mockRestore();
    // Reset the cache so subsequent test files start fresh — the cache is
    // process-global, so leaving it primed could mask a regression in a
    // later file that depends on the walk happening.
    clearBundledSkillsCache();
  });

  /**
   * Count `readdirSync` invocations that walked the bundled skills tree.
   *
   * The legacy code path called `readdirSync(skillsRoot)` and then
   * `readdirSync(<skillsRoot>/<category>)` per call. With the index, both
   * of these fire exactly once during the initial build and never again.
   *
   * We deliberately don't count `readdirSync` calls inside
   * `cpSync`'s recursive copy (those are reads of `<skillsRoot>/<category>/<id>/...`
   * subtrees during installBundledSkill) because that's not the perf
   * regression being guarded — `cpSync` is unavoidable for the actual
   * file copy and isn't repeated unnecessarily.
   *
   * Heuristic: count reads whose path ends at depth <=2 below the skills
   * root (i.e. the root itself or a direct category subdirectory).
   */
  function skillTreeReaddirCalls(): number {
    return readdirSpy.mock.calls.filter((args) => {
      const first = args[0];
      if (typeof first !== 'string') return false;
      const skillsIdx = first.lastIndexOf(`${path.sep}skills`);
      if (skillsIdx < 0) return false;
      const tail = first.slice(skillsIdx + `${path.sep}skills`.length);
      // Exclude reads of project-side `.claude/skills/...` dest paths.
      if (first.includes(`.claude${path.sep}skills`)) return false;
      // Match the skills root itself ("") or a single category level
      // ("/integration", "/taxonomy"). Reject deeper paths — those come
      // from cpSync's recursive walk, not from the helpers we're guarding.
      const depth = tail.split(path.sep).filter(Boolean).length;
      return depth <= 1;
    }).length;
  }

  /**
   * Count `readFileSync` invocations against `SKILL.md` files. Pre-fix
   * the menu loader read every SKILL.md per call to extract a single
   * frontmatter line; the index now reads each SKILL.md exactly once.
   */
  function skillMdReadFileCalls(): number {
    return readFileSpy.mock.calls.filter((args) => {
      const first = args[0];
      return typeof first === 'string' && first.endsWith('SKILL.md');
    }).length;
  }

  it('walks the skill tree once across many lookups', () => {
    // Hammer every public helper a few times. Pre-fix this would have
    // produced dozens of `readdirSync` calls against the skills root.
    for (let i = 0; i < 5; i++) {
      loadBundledSkillMenu();
      bundledSkillExists('wizard-prompt-supplement');
      bundledSkillExists('does-not-exist');
      readBundledSkillBody('wizard-prompt-supplement');
      readBundledSkillBody('also-missing');
    }

    // The index walks each category dir once: one readdir for the
    // skills root, plus one per category subdirectory. We don't pin
    // the exact category count (the bundle evolves), but we DO pin
    // that further calls don't add to the readdir count.
    const afterFirstBatch = skillTreeReaddirCalls();
    expect(afterFirstBatch).toBeGreaterThan(0);

    // Another round of calls — none of these should hit readdirSync.
    for (let i = 0; i < 5; i++) {
      loadBundledSkillMenu();
      bundledSkillExists('wizard-prompt-supplement');
      readBundledSkillBody('wizard-prompt-supplement');
    }

    expect(skillTreeReaddirCalls()).toBe(afterFirstBatch);
  });

  it('reads each SKILL.md exactly once even when the menu is rebuilt many times', () => {
    // The menu builder used to read every SKILL.md from disk on every
    // call to extract a frontmatter line. With the index, each
    // SKILL.md body is read once during the initial walk and reused
    // for every subsequent menu rebuild.
    loadBundledSkillMenu();
    const afterFirst = skillMdReadFileCalls();
    expect(afterFirst).toBeGreaterThan(0);

    // 10 more menu rebuilds + a bunch of body reads — none should hit
    // readFileSync against any SKILL.md.
    for (let i = 0; i < 10; i++) {
      loadBundledSkillMenu();
      readBundledSkillBody('wizard-prompt-supplement');
      readBundledSkillBody('amplitude-quickstart-taxonomy-agent');
    }

    expect(skillMdReadFileCalls()).toBe(afterFirst);
  });

  it('rebuilds the index after clearBundledSkillsCache (test contract)', () => {
    // Sanity: clearing the cache must actually trigger another walk —
    // otherwise tests that mock the filesystem would observe stale data.
    loadBundledSkillMenu();
    const firstWalk = skillTreeReaddirCalls();
    expect(firstWalk).toBeGreaterThan(0);

    // Without clearing: another call should NOT walk again.
    loadBundledSkillMenu();
    expect(skillTreeReaddirCalls()).toBe(firstWalk);

    // After clearing: the next call walks again.
    clearBundledSkillsCache();
    loadBundledSkillMenu();
    expect(skillTreeReaddirCalls()).toBeGreaterThan(firstWalk);
  });

  it('readBundledSkillReference does not re-walk the skill tree', () => {
    // Reference files aren't pre-loaded into the index (there are
    // many per skill and most are never requested). But the lookup
    // path that resolves the skill's directory must still be O(1) —
    // it should consult the index, not re-read the skills root.
    loadBundledSkillMenu();
    const baseline = skillTreeReaddirCalls();

    // Try a reference that almost certainly doesn't exist. The
    // important thing is the helper doesn't trigger a re-walk on
    // its way to returning null.
    readBundledSkillReference('wizard-prompt-supplement', 'references/x.md');
    readBundledSkillReference(
      'amplitude-quickstart-taxonomy-agent',
      'references/y.md',
    );
    readBundledSkillReference('not-a-real-skill', 'references/z.md');

    expect(skillTreeReaddirCalls()).toBe(baseline);
  });

  it('installBundledSkill does not re-walk the skill tree to locate the source', () => {
    // The legacy implementation iterated every category looking for
    // the skillId. With the index, we know the source path
    // immediately — fs.readdirSync on the skills root must not fire.
    loadBundledSkillMenu();
    const baseline = skillTreeReaddirCalls();

    const tmpDest = fs.mkdtempSync(
      path.join(require('os').tmpdir(), 'wizard-install-skill-test-'),
    );
    try {
      const result = installBundledSkill('wizard-prompt-supplement', tmpDest);
      expect(result.success).toBe(true);
    } finally {
      fs.rmSync(tmpDest, { recursive: true, force: true });
    }

    expect(skillTreeReaddirCalls()).toBe(baseline);
  });
});
