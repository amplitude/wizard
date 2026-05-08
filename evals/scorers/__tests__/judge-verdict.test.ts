/**
 * Unit tests for L6-judge-verdict.
 *
 * Covers:
 *   - skip-pass when judgeResult is absent
 *   - failure when judge call failed (ok=false → uses detail)
 *   - skip-pass when judge returned zero verdicts
 *   - pass when every verdict passed (sums weights)
 *   - failure when one or more verdicts failed (names criteria + paths)
 */

import { describe, expect, it } from 'vitest';

import { scorer } from '../layer6-judge/judge-verdict.js';
import type { Artifact, Scenario } from '../../runner/types.js';
import type { JudgeResult, Verdict } from '../../runner/judge.js';

function makeArtifact(judgeResult?: JudgeResult): Artifact {
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
    judgeResult,
    source: 'golden',
  };
}

const FAKE_SCENARIO = {} as Scenario;

function judge(verdicts: Verdict[], ok = true): JudgeResult {
  return {
    ok,
    response: ok
      ? {
          rubric_version: '2026-05-08.1',
          verdicts,
          free_form: '',
        }
      : undefined,
    rubricVersion: '2026-05-08.1',
    durationMs: 1_000,
  };
}

describe('L6-judge-verdict', () => {
  it('skip-passes when judgeResult is absent', () => {
    const result = scorer.evaluate(makeArtifact(), FAKE_SCENARIO);
    expect(result.pass).toBe(true);
    expect(result.weight).toBe(0);
    expect(result.detail).toContain('skipped');
  });

  it('fails when judge call failed and surfaces the runner detail', () => {
    const result = scorer.evaluate(
      makeArtifact({
        ok: false,
        detail: 'ANTHROPIC_API_KEY not set',
        rubricVersion: '2026-05-08.1',
        durationMs: 0,
      }),
      FAKE_SCENARIO,
    );
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('ANTHROPIC_API_KEY');
  });

  it('passes when every verdict passes and sums weights', () => {
    const result = scorer.evaluate(
      makeArtifact(
        judge([
          {
            criterion: 7,
            pass: true,
            weight: 5,
            rationale: 'options carry comments',
            evidence_path: 'src/app/AmplitudeProvider.tsx',
            evidence_line_start: 22,
          },
          {
            criterion: 19,
            pass: true,
            weight: 5,
            rationale: 'setup_complete files match diff',
            evidence_path: 'src/app/page.tsx',
            evidence_line_start: 5,
          },
        ]),
      ),
      FAKE_SCENARIO,
    );
    expect(result.pass).toBe(true);
    expect(result.weight).toBe(10);
  });

  it('fails when at least one verdict failed and names the criteria', () => {
    const result = scorer.evaluate(
      makeArtifact(
        judge([
          {
            criterion: 7,
            pass: false,
            weight: 5,
            rationale: 'init options have no comments',
            evidence_path: 'src/app/AmplitudeProvider.tsx',
            evidence_line_start: 22,
          },
          {
            criterion: 19,
            pass: true,
            weight: 5,
            rationale: 'setup_complete matches',
            evidence_path: 'src/app/page.tsx',
            evidence_line_start: 5,
          },
        ]),
      ),
      FAKE_SCENARIO,
    );
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('criterion 7');
    expect(result.detail).toContain('AmplitudeProvider.tsx:22');
  });

  it('skip-passes (weight 0) when judge returned zero verdicts', () => {
    const result = scorer.evaluate(makeArtifact(judge([])), FAKE_SCENARIO);
    expect(result.pass).toBe(true);
    expect(result.weight).toBe(0);
  });
});
