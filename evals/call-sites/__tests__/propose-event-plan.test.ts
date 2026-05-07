/**
 * Per-call-site green run for `propose_event_plan`.
 *
 * Loads the bundled fixture, runs the scorer against the fixture's
 * `recordedOutput` (golden mode — no live LLM), and asserts the
 * score passes. Negative-control variants exercise the snake_case,
 * cardinality, and hallucination guards.
 *
 * Per the constraint: no live LLM calls in the unit-test path. The
 * scorer is what changes when prompts change; the artifact is held
 * fixed.
 */

import { describe, expect, it } from 'vitest';

import { getCallSite } from '../registry.js';
import { runCallSite } from '../run-call-site.js';
import { scorer } from '../propose-event-plan/scorer.js';

const callSite = getCallSite('propose_event_plan');

describe('call site: propose_event_plan', () => {
  it('passes the scorer on the bundled golden fixture', async () => {
    const artifact = await runCallSite({ callSite, source: 'golden' });
    const fixture = (artifact.output as { events: unknown[] }) ?? null;
    expect(fixture).toBeTruthy();
    const result = scorer.evaluate(artifact, {
      id: 'baseline',
      callSiteId: callSite.id,
      description: '',
      kind: 'structured-output',
      input: { maxEvents: 25 },
    });
    expect(result.pass).toBe(true);
  });

  it('rejects Title Case event names (snake_case guard)', async () => {
    const artifact = await runCallSite({
      callSite,
      source: 'mock',
      mockInvoker: () => ({
        events: [
          { name: 'Page Viewed', description: 'bad casing' },
          { name: 'sign_up_completed', description: 'ok' },
        ],
      }),
    });
    const result = scorer.evaluate(artifact, {
      id: 'snake-case-fail',
      callSiteId: callSite.id,
      description: '',
      kind: 'structured-output',
      input: { maxEvents: 25 },
    });
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/snake_case/);
  });

  it('rejects exceeding maxEvents (cardinality guard)', async () => {
    const events = Array.from({ length: 30 }, (_, i) => ({
      name: `event_${i}`,
    }));
    const artifact = await runCallSite({
      callSite,
      source: 'mock',
      mockInvoker: () => ({ events }),
    });
    const result = scorer.evaluate(artifact, {
      id: 'too-many',
      callSiteId: callSite.id,
      description: '',
      kind: 'structured-output',
      input: { maxEvents: 25 },
    });
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/maxEvents/);
  });

  it('rejects obvious hallucinations like "click" / "do_thing"', async () => {
    const artifact = await runCallSite({
      callSite,
      source: 'mock',
      mockInvoker: () => ({
        events: [{ name: 'click' }, { name: 'sign_up_completed' }],
      }),
    });
    const result = scorer.evaluate(artifact, {
      id: 'hallucinated',
      callSiteId: callSite.id,
      description: '',
      kind: 'structured-output',
      input: { maxEvents: 25 },
    });
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/hallucination/);
  });

  it('rejects duplicate event names', async () => {
    const artifact = await runCallSite({
      callSite,
      source: 'mock',
      mockInvoker: () => ({
        events: [{ name: 'page_viewed' }, { name: 'page_viewed' }],
      }),
    });
    const result = scorer.evaluate(artifact, {
      id: 'dup',
      callSiteId: callSite.id,
      description: '',
      kind: 'structured-output',
      input: { maxEvents: 25 },
    });
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/duplicated/);
  });
});
