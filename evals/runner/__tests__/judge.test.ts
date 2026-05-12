/**
 * Unit tests for the judge runner.
 *
 * The judge is gated on `ANTHROPIC_API_KEY` and the `@anthropic-ai/sdk`
 * dependency, so we test the structured-output validation path directly:
 *
 *   - Missing API key returns a skip-result with weight 0.
 *   - Schemas reject invalid verdicts (criterion out of range, missing
 *     citation).
 *   - Schemas accept the canonical shape from the rubric.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { JudgeResponseSchema, VerdictSchema, runJudge } from '../judge.js';
import type { Artifact, Scenario } from '../types.js';

const VALID_VERDICT = {
  criterion: 7,
  pass: true,
  weight: 5,
  rationale: 'init options carry comments',
  evidence_path: 'src/app/AmplitudeProvider.tsx',
  evidence_line_start: 22,
};

describe('judge schema validation', () => {
  it('accepts a verdict matching the canonical shape', () => {
    expect(VerdictSchema.safeParse(VALID_VERDICT).success).toBe(true);
  });

  it('rejects a verdict with criterion out of 1–19 range', () => {
    const result = VerdictSchema.safeParse({ ...VALID_VERDICT, criterion: 99 });
    expect(result.success).toBe(false);
  });

  it('rejects a verdict missing evidence_path (citation required)', () => {
    const rest = { ...VALID_VERDICT } as Partial<typeof VALID_VERDICT>;
    delete rest.evidence_path;
    const result = VerdictSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects a verdict with non-positive evidence_line_start', () => {
    const result = VerdictSchema.safeParse({
      ...VALID_VERDICT,
      evidence_line_start: 0,
    });
    expect(result.success).toBe(false);
  });

  it('accepts a JudgeResponse with empty verdicts array', () => {
    const result = JudgeResponseSchema.safeParse({
      rubric_version: '2026-05-08.1',
      verdicts: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a JudgeResponse missing rubric_version', () => {
    const result = JudgeResponseSchema.safeParse({ verdicts: [] });
    expect(result.success).toBe(false);
  });
});

describe('runJudge — auth gating', () => {
  let priorKey: string | undefined;
  beforeEach(() => {
    priorKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = priorKey;
  });

  it('returns ok=false with a clear detail when ANTHROPIC_API_KEY is unset', async () => {
    const artifact: Artifact = {
      runId: 'r-test',
      scenario: 'test',
      ring: 1,
      startedAt: '',
      finishedAt: '',
      exitCode: 0,
      runLog: [],
      fsSnapshot: { files: {}, diff: { added: [], modified: [], deleted: [] } },
      stderr: '',
      source: 'golden',
    };
    const result = await runJudge({
      scenario: { name: 'test', ring: 1 } as unknown as Scenario,
      artifact,
      workingDir: '/tmp',
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('ANTHROPIC_API_KEY');
    expect(result.rubricVersion).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});
