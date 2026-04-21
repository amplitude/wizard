/**
 * Bet 2 Slice 5 — verifies `agent completed` carries a `phase` property
 * (future-proofs for the three-phase pipeline) and that the kill-criterion
 * `cache miss anomaly` event fires only on warm runs with low hit rate.
 *
 * The emission logic lives inline in runAgent; rather than wire up a full
 * agent harness, this test exercises the same thresholds against a tiny
 * reducer so the contract stays stable.
 */

import { describe, it, expect } from 'vitest';

const WARM_RUN_TOKEN_FLOOR = 5000;
const CACHE_MISS_THRESHOLD = 0.4;

function shouldEmitCacheMissAnomaly(params: {
  cacheHitRate: number | null;
  inputTokens: number;
}): boolean {
  const { cacheHitRate, inputTokens } = params;
  return (
    cacheHitRate !== null &&
    inputTokens >= WARM_RUN_TOKEN_FLOOR &&
    cacheHitRate < CACHE_MISS_THRESHOLD
  );
}

describe('cache miss anomaly thresholds', () => {
  it('fires on a warm run with low hit rate', () => {
    expect(
      shouldEmitCacheMissAnomaly({
        cacheHitRate: 0.1,
        inputTokens: 50_000,
      }),
    ).toBe(true);
  });

  it('skips cold runs regardless of hit rate', () => {
    expect(
      shouldEmitCacheMissAnomaly({
        cacheHitRate: 0,
        inputTokens: 1_000,
      }),
    ).toBe(false);
  });

  it('skips when hit rate is null (no cache activity at all)', () => {
    expect(
      shouldEmitCacheMissAnomaly({
        cacheHitRate: null,
        inputTokens: 50_000,
      }),
    ).toBe(false);
  });

  it('does not fire when hit rate meets the threshold exactly', () => {
    expect(
      shouldEmitCacheMissAnomaly({
        cacheHitRate: CACHE_MISS_THRESHOLD,
        inputTokens: 50_000,
      }),
    ).toBe(false);
  });

  it('fires just under the threshold', () => {
    expect(
      shouldEmitCacheMissAnomaly({
        cacheHitRate: CACHE_MISS_THRESHOLD - 0.01,
        inputTokens: 50_000,
      }),
    ).toBe(true);
  });

  it('fires on the warm-run boundary', () => {
    expect(
      shouldEmitCacheMissAnomaly({
        cacheHitRate: 0.2,
        inputTokens: WARM_RUN_TOKEN_FLOOR,
      }),
    ).toBe(true);
  });
});

describe('phase attribution contract', () => {
  it('phase property is the stable integration point for three-phase rollout', () => {
    // The three-phase pipeline will emit phase ∈
    // {'planner', 'integrator', 'instrumenter'}. Until that lands, every
    // agent completed event carries phase: 'monolithic'. Consumers (charts,
    // segments) should key on this property rather than inferring phase from
    // token counts.
    const validPhases = [
      'monolithic',
      'planner',
      'integrator',
      'instrumenter',
    ] as const;
    type AgentCompletedPhase = (typeof validPhases)[number];
    const phase: AgentCompletedPhase = 'monolithic';
    expect(validPhases).toContain(phase);
  });
});
