/**
 * Unit tests for L1-self-verification-passes (criterion 17).
 *
 * Covers:
 *   - skip-pass when no verification_result events present (older
 *     goldens / skipped phase)
 *   - pass when every verification phase reports success
 *   - fail when overall phase reports success=false (with reasons)
 *   - fail when any phase reports success=false even if overall passed
 */

import { describe, expect, it } from 'vitest';

import type { AgentEventEnvelope } from '../../../src/lib/agent-events.js';
import { scorer } from '../layer1-structural/self-verification-passes.js';
import type { Artifact, Scenario } from '../../runner/types.js';

function verificationEvent(
  phase: 'sdk_present' | 'api_key' | 'ingestion' | 'overall',
  success: boolean,
  failures?: string[],
): AgentEventEnvelope {
  return {
    v: 1,
    '@timestamp': '2026-05-08T10:00:00.000Z',
    type: 'lifecycle',
    message: `verification_result: ${phase}`,
    data: { event: 'verification_result', phase, success, failures },
    data_version: 1,
  } as AgentEventEnvelope;
}

function makeArtifact(runLog: AgentEventEnvelope[]): Artifact {
  return {
    runId: 'r-test',
    scenario: 'test',
    ring: 1,
    startedAt: '2026-05-08T10:00:00.000Z',
    finishedAt: '2026-05-08T10:00:01.000Z',
    exitCode: 0,
    runLog,
    fsSnapshot: { files: {}, diff: { added: [], modified: [], deleted: [] } },
    stderr: '',
    source: 'golden',
  };
}

const FAKE_SCENARIO = {} as Scenario;

describe('L1-self-verification-passes', () => {
  it('skip-passes with weight 0 when no verification events present', () => {
    const result = scorer.evaluate(makeArtifact([]), FAKE_SCENARIO);
    expect(result.pass).toBe(true);
    expect(result.weight).toBe(0);
    expect(result.detail).toContain('skipped');
  });

  it('passes when overall verification succeeds', () => {
    const result = scorer.evaluate(
      makeArtifact([verificationEvent('overall', true)]),
      FAKE_SCENARIO,
    );
    expect(result.pass).toBe(true);
    expect(result.weight).toBe(5);
  });

  it('fails when overall verification reports failure with reasons', () => {
    const result = scorer.evaluate(
      makeArtifact([
        verificationEvent('overall', false, [
          'AmplitudeProvider not mounted',
          'env var missing',
        ]),
      ]),
      FAKE_SCENARIO,
    );
    expect(result.pass).toBe(false);
    expect(result.weight).toBe(5);
    expect(result.detail).toContain('overall');
    expect(result.detail).toContain('AmplitudeProvider not mounted');
  });

  it('fails when any phase reports failure even if overall passed', () => {
    const result = scorer.evaluate(
      makeArtifact([
        verificationEvent('sdk_present', true),
        verificationEvent('api_key', false, ['missing']),
        verificationEvent('overall', true),
      ]),
      FAKE_SCENARIO,
    );
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('api_key');
    expect(result.detail).toContain('missing');
  });
});
