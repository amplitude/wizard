import { afterEach, describe, expect, it, vi } from 'vitest';

describe('buildSkillTierSystemPromptAppend', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('returns empty string when tier flag is off', async () => {
    vi.stubEnv('AMPLITUDE_WIZARD_SKILL_TIERS', '0');
    const { buildSkillTierSystemPromptAppend } = await import(
      '../skill-tier-prompt.js'
    );
    expect(buildSkillTierSystemPromptAppend()).toBe('');
  });

  it('returns a fenced JSON block when tier flag is on', async () => {
    vi.stubEnv('AMPLITUDE_WIZARD_SKILL_TIERS', '1');
    const { buildSkillTierSystemPromptAppend } = await import(
      '../skill-tier-prompt.js'
    );
    const out = buildSkillTierSystemPromptAppend();
    expect(out).toContain('## Bundled skill menu');
    expect(out).toContain('```json');
    expect(out).toContain('"categories"');
  });
});
