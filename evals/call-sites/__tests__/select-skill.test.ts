/**
 * Per-call-site green run for `select_skill`.
 *
 * Three cases:
 *
 *   1. Picking the obvious match passes.
 *   2. Picking a skill ID not in the menu fails (hallucination).
 *   3. Declining when no plausible match exists passes.
 *   4. Declining when a plausible match DOES exist fails.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { getCallSite, resolveCallSitePath } from '../registry.js';
import { runCallSite } from '../run-call-site.js';
import { scorer } from '../select-skill/scorer.js';
import type { CallSiteFixture } from '../types.js';

const callSite = getCallSite('select_skill');

function readBundledFixture(): CallSiteFixture {
  const path = resolveCallSitePath(callSite.fixture);
  return JSON.parse(readFileSync(path, 'utf8')) as CallSiteFixture;
}

describe('call site: select_skill', () => {
  it('passes on the bundled fixture (correct match)', async () => {
    const fixture = readBundledFixture();
    const artifact = await runCallSite({ callSite, source: 'golden' });
    const result = scorer.evaluate(artifact, fixture);
    expect(result.pass).toBe(true);
  });

  it('rejects a skill ID not in the menu', async () => {
    const fixture = readBundledFixture();
    const artifact = await runCallSite({
      callSite,
      source: 'mock',
      mockInvoker: () => ({
        selectedSkillId: 'integration/erlang',
        rationale: 'made up',
      }),
    });
    const result = scorer.evaluate(artifact, fixture);
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/hallucinated|not in the menu/);
  });

  it('rejects declining when a plausible match exists', async () => {
    const fixture = readBundledFixture();
    const artifact = await runCallSite({
      callSite,
      source: 'mock',
      mockInvoker: () => ({ selectedSkillId: null }),
    });
    const result = scorer.evaluate(artifact, fixture);
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/declined/);
  });

  it('passes declining when no plausible match exists', async () => {
    const noMatchFixture: CallSiteFixture = {
      id: 'no-match',
      callSiteId: callSite.id,
      description: 'Phase=integration but no nextjs entry in the menu.',
      kind: 'tool-decision',
      input: {
        phase: 'integration',
        framework: 'rust',
        menu: [
          { id: 'integration/nextjs', title: 'nextjs' },
          { id: 'integration/vue', title: 'vue' },
        ],
      },
    };
    const artifact = await runCallSite({
      callSite,
      source: 'mock',
      mockInvoker: () => ({ selectedSkillId: null }),
    });
    const result = scorer.evaluate(artifact, noMatchFixture);
    expect(result.pass).toBe(true);
  });

  it('rejects picking a menu skill that ignores the phase/framework match', async () => {
    const fixture = readBundledFixture();
    const artifact = await runCallSite({
      callSite,
      source: 'mock',
      mockInvoker: () => ({
        selectedSkillId: 'integration/django',
        rationale: 'wrong framework',
      }),
    });
    const result = scorer.evaluate(artifact, fixture);
    expect(result.pass).toBe(false);
  });
});
