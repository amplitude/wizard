/**
 * Unit tests for L4-runtime-probe.
 *
 * Covers:
 *   - skip-pass with weight 0 when runtimeResult is absent
 *   - failure when runtimeResult.ok=false (uses detail)
 *   - failure when pageStatusCode is non-2xx/3xx
 *   - failure when consoleErrors are present
 *   - failure when amplitudeRequestCount is 0 even on a clean page
 *   - pass when ok + 200 + no errors + ≥1 Amplitude request
 */

import { describe, expect, it } from 'vitest';

import { scorer } from '../layer4-runtime/runtime-probe.js';
import type { Artifact, RuntimeResult, Scenario } from '../../runner/types.js';

function makeArtifact(runtimeResult?: RuntimeResult): Artifact {
  return {
    runId: 'r-test',
    scenario: 'test',
    ring: 1,
    startedAt: '2026-05-08T10:00:00.000Z',
    finishedAt: '2026-05-08T10:00:01.000Z',
    exitCode: 0,
    runLog: [],
    fsSnapshot: { files: {}, diff: { added: [], modified: [], deleted: [] } },
    stderr: '',
    runtimeResult,
    source: 'golden',
  };
}

const FAKE_SCENARIO = {} as Scenario;

const CLEAN_RESULT: RuntimeResult = {
  url: 'http://localhost:5173/',
  pageStatusCode: 200,
  consoleErrors: [],
  amplitudeRequestCount: 2,
  amplitudeRequestPaths: [
    'https://api2.amplitude.com/2/httpapi',
    'https://api2.amplitude.com/2/httpapi',
  ],
  ok: true,
  durationMs: 4_500,
};

describe('L4-runtime-probe', () => {
  it('skip-passes with weight 0 when runtimeResult is absent', () => {
    const result = scorer.evaluate(makeArtifact(), FAKE_SCENARIO);
    expect(result.pass).toBe(true);
    expect(result.weight).toBe(0);
    expect(result.detail).toContain('skipped');
  });

  it('passes on a clean probe with ≥1 Amplitude request', () => {
    const result = scorer.evaluate(makeArtifact(CLEAN_RESULT), FAKE_SCENARIO);
    expect(result.pass).toBe(true);
    expect(result.weight).toBe(10);
  });

  it('fails when ok=false and surfaces the probe detail', () => {
    const result = scorer.evaluate(
      makeArtifact({
        ...CLEAN_RESULT,
        ok: false,
        detail: 'dev server did not boot in 60000ms',
      }),
      FAKE_SCENARIO,
    );
    expect(result.pass).toBe(false);
    expect(result.weight).toBe(10);
    expect(result.detail).toContain('dev server did not boot');
  });

  it('fails when navigation returned a 5xx status', () => {
    const result = scorer.evaluate(
      makeArtifact({ ...CLEAN_RESULT, pageStatusCode: 500 }),
      FAKE_SCENARIO,
    );
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('500');
  });

  it('fails when the page logged uncaught console errors', () => {
    const result = scorer.evaluate(
      makeArtifact({
        ...CLEAN_RESULT,
        consoleErrors: ['Uncaught: amplitude is not defined'],
      }),
      FAKE_SCENARIO,
    );
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('amplitude is not defined');
  });

  it('fails when the page rendered cleanly but the SDK never fired', () => {
    const result = scorer.evaluate(
      makeArtifact({
        ...CLEAN_RESULT,
        amplitudeRequestCount: 0,
        amplitudeRequestPaths: [],
      }),
      FAKE_SCENARIO,
    );
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('zero outbound requests');
  });
});
