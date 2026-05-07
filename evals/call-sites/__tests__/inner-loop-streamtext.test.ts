/**
 * Per-call-site green run for `inner-loop-streamtext`.
 *
 * Loads the bundled `golden.ndjson` slice through `runCallSite`'s
 * golden-replay path and asserts the L0 + L1 structural checks pass.
 * Negative-control variants exercise the wire-version invariant and
 * the run_completed / setup_complete agreement.
 *
 * The bundled golden is a smoke-shape recording. Per the constraint
 * documented in the runner README, regenerating it requires
 * `WIZARD_OAUTH_TOKEN` once §7.5 wizard-side wiring lands — those
 * tests live in a follow-up PR, not this one.
 */

import { describe, expect, it } from 'vitest';

import { getCallSite } from '../registry.js';
import { runCallSite } from '../run-call-site.js';
import { scorer } from '../inner-loop-streamtext/scorer.js';
import type { CallSiteFixture } from '../types.js';

const callSite = getCallSite('inner-loop-streamtext');

const dummyFixture: CallSiteFixture = {
  id: 'inner-loop-streamtext-baseline',
  callSiteId: callSite.id,
  description: '',
  kind: 'streaming',
  input: {},
};

describe('call site: inner-loop-streamtext', () => {
  it('passes on the bundled golden.ndjson slice', async () => {
    const artifact = await runCallSite({ callSite, source: 'golden' });
    const result = scorer.evaluate(artifact, dummyFixture);
    expect(result.pass).toBe(true);
  });

  it('hard-fails when an event has the wrong wire version', async () => {
    const artifact = await runCallSite({
      callSite,
      source: 'mock',
      mockInvoker: () => [
        {
          v: 1,
          message: 'inner_agent_started',
          data: { event: 'inner_agent_started' },
        },
        { v: 2, message: 'file_change_planned' },
        {
          v: 1,
          message: 'setup_complete',
          data: { event: 'setup_complete', outcome: 'success' },
        },
        {
          v: 1,
          message: 'run_completed',
          data: { event: 'run_completed', outcome: 'success' },
        },
      ],
    });
    const result = scorer.evaluate(artifact, dummyFixture);
    expect(result.pass).toBe(false);
    expect(result.hardFail).toBe(true);
    expect(result.detail).toMatch(/v=2/);
  });

  it('rejects multiple run_completed events', async () => {
    const artifact = await runCallSite({
      callSite,
      source: 'mock',
      mockInvoker: () => [
        {
          v: 1,
          message: 'setup_complete',
          data: { event: 'setup_complete', outcome: 'success' },
        },
        {
          v: 1,
          message: 'run_completed',
          data: { event: 'run_completed', outcome: 'success' },
        },
        {
          v: 1,
          message: 'run_completed',
          data: { event: 'run_completed', outcome: 'success' },
        },
      ],
    });
    const result = scorer.evaluate(artifact, dummyFixture);
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/exactly one run_completed/);
  });

  it('rejects setup_complete / run_completed outcome mismatch', async () => {
    const artifact = await runCallSite({
      callSite,
      source: 'mock',
      mockInvoker: () => [
        {
          v: 1,
          message: 'setup_complete',
          data: { event: 'setup_complete', outcome: 'success' },
        },
        {
          v: 1,
          message: 'run_completed',
          data: { event: 'run_completed', outcome: 'failure' },
        },
      ],
    });
    const result = scorer.evaluate(artifact, dummyFixture);
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/disagrees/);
  });

  it('rejects an empty NDJSON slice', async () => {
    const artifact = await runCallSite({
      callSite,
      source: 'mock',
      mockInvoker: () => [],
    });
    const result = scorer.evaluate(artifact, dummyFixture);
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/no NDJSON events/);
  });
});
