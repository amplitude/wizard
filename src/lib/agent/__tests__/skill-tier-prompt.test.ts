import { afterEach, describe, expect, it, vi } from 'vitest';

describe('buildSkillTierSystemPromptAppend', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('returns empty string when tier flag is opted-out (=0)', async () => {
    vi.stubEnv('AMPLITUDE_WIZARD_SKILL_TIERS', '0');
    const { buildSkillTierSystemPromptAppend } = await import(
      '../skill-tier-prompt.js'
    );
    expect(buildSkillTierSystemPromptAppend()).toBe('');
  });

  it('returns a fenced JSON block by default (tiers default-on)', async () => {
    vi.stubEnv('AMPLITUDE_WIZARD_SKILL_TIERS', '');
    const { buildSkillTierSystemPromptAppend } = await import(
      '../skill-tier-prompt.js'
    );
    const out = buildSkillTierSystemPromptAppend();
    expect(out).toContain('## Bundled skill menu');
    expect(out).toContain('```json');
    expect(out).toContain('"categories"');
    // The new commandment must instruct lazy loading.
    expect(out.toLowerCase()).toContain('not pre-loaded');
  });

  it('returns a fenced JSON block when tier flag is on (=1)', async () => {
    vi.stubEnv('AMPLITUDE_WIZARD_SKILL_TIERS', '1');
    const { buildSkillTierSystemPromptAppend } = await import(
      '../skill-tier-prompt.js'
    );
    const out = buildSkillTierSystemPromptAppend();
    expect(out).toContain('## Bundled skill menu');
    expect(out).toContain('```json');
    expect(out).toContain('"categories"');
  });

  it('keeps embedded JSON valid even when the menu would overflow the budget', async () => {
    vi.stubEnv('AMPLITUDE_WIZARD_SKILL_TIERS', '1');
    // Synthesize an oversized menu — the real bundled menu may or may not
    // exceed the budget today, but we want a regression test that exercises
    // the trimming branch deterministically.
    const huge: {
      categories: Record<
        string,
        { id: string; name: string; downloadUrl: string }[]
      >;
    } = {
      categories: {
        integration: Array.from({ length: 5_000 }, (_, i) => ({
          id: `skill-${i}`,
          name: `Skill number ${i} with a deliberately long human-readable name to force overflow`,
          downloadUrl: '',
        })),
      },
    };
    vi.doMock('../../wizard-tools.js', () => ({
      loadBundledSkillMenu: () => huge,
      // Default-on flag check; mirror the real helper so the prompt
      // builder doesn't bail out early on the mocked import.
      isSkillTiersEnabled: () =>
        process.env.AMPLITUDE_WIZARD_SKILL_TIERS !== '0',
    }));
    const { buildSkillTierSystemPromptAppend } = await import(
      '../skill-tier-prompt.js'
    );
    const out = buildSkillTierSystemPromptAppend();
    expect(out).toContain('## Bundled skill menu');
    const fenceMatch = /```json\n([\s\S]*?)\n```/.exec(out);
    if (fenceMatch) {
      // If a fenced block is emitted, it must parse as valid JSON.
      expect(() => JSON.parse(fenceMatch[1])).not.toThrow();
    } else {
      // Otherwise the fallback note must be present.
      expect(out).toMatch(/menu too large|load_skill_menu/);
    }
  });
});
