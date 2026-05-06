/**
 * Layer 3 build-passes scorer — verify the three states it grades:
 * no buildResult (skip-pass), exit 0 (full pass), non-zero (fail).
 */

import { describe, expect, it } from 'vitest';

import { scorer } from '../layer3-build/build-passes.js';
import type { Artifact, Scenario } from '../../runner/types.js';

const baseArtifact: Omit<Artifact, 'buildResult'> = {
  runId: 'run-test',
  scenario: 'test',
  ring: 1,
  startedAt: '2026-05-06T12:00:00Z',
  finishedAt: '2026-05-06T12:00:01Z',
  exitCode: 0,
  runLog: [],
  fsSnapshot: { files: {}, diff: { added: [], modified: [], deleted: [] } },
  stderr: '',
  source: 'live',
};

const dummyScenario = {} as Scenario;

describe('L3 build-passes scorer', () => {
  it('skip-passes (weight 0) when no buildResult is on the artifact', () => {
    const r = scorer.evaluate(baseArtifact as Artifact, dummyScenario);
    expect(r.pass).toBe(true);
    expect(r.weight).toBe(0);
    expect(r.detail).toMatch(/not exercised/);
  });

  it('passes with weight 10 when build exits 0', () => {
    const a: Artifact = {
      ...baseArtifact,
      buildResult: {
        exitCode: 0,
        installExitCode: 0,
        stderrTail: '',
        durationMs: 12345,
      },
    };
    const r = scorer.evaluate(a, dummyScenario);
    expect(r.pass).toBe(true);
    expect(r.weight).toBe(10);
    expect(r.detail).toMatch(/12345ms/);
  });

  it('fails with the build stderr tail when build exits non-zero', () => {
    const a: Artifact = {
      ...baseArtifact,
      buildResult: {
        exitCode: 2,
        installExitCode: 0,
        stderrTail: 'TS2304: Cannot find name "Amplitude"',
        durationMs: 4242,
      },
    };
    const r = scorer.evaluate(a, dummyScenario);
    expect(r.pass).toBe(false);
    expect(r.weight).toBe(10);
    expect(r.detail).toMatch(/build failed.*TS2304/s);
  });

  it('distinguishes install failure from build failure', () => {
    const a: Artifact = {
      ...baseArtifact,
      buildResult: {
        exitCode: 1,
        installExitCode: 1,
        stderrTail: 'ERR_PNPM_FROZEN_LOCKFILE',
        durationMs: 9999,
      },
    };
    const r = scorer.evaluate(a, dummyScenario);
    expect(r.pass).toBe(false);
    expect(r.detail).toMatch(/install failed/);
    expect(r.detail).toMatch(/lockfile drift/);
  });
});
