/**
 * Unit tests for the variance-summary CLI script.
 *
 * Drives the script by writing fake reports under a tmpdir, invoking
 * the CLI with `tsx`, and asserting the output JSON shape + exit code.
 *
 * The threshold (10 points) and flagging behavior are the spec's
 * "non-determinism" line — a scenario with seed-to-seed spread > 10
 * gets flagged for prompt/skill tightening, and the script exits
 * non-zero so the nightly job surfaces it.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

const SCRIPT = resolve(__dirname, '..', '..', 'bin', 'variance-summary.ts');

function writeReport(
  root: string,
  subdir: string,
  scenario: string,
  totalScore: number,
  seed: number,
): void {
  const dir = join(root, subdir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'report.json'),
    JSON.stringify({
      scenario,
      totalScore,
      maxScore: 100,
      hardFailed: false,
      artifact: { seed },
    }),
  );
}

function runVariance(
  root: string,
  outPath: string,
): { exitCode: number; output: string } {
  try {
    const stdout = execFileSync(
      'pnpm',
      ['exec', 'tsx', SCRIPT, root, '--out', outPath],
      { encoding: 'utf8' },
    );
    return { exitCode: 0, output: stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    return { exitCode: e.status ?? 1, output: e.stdout ?? '' };
  }
}

describe('variance-summary CLI', () => {
  let workdir: string;
  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), 'variance-test-'));
  });
  afterAll(() => {
    // Best-effort cleanup; tmpdir collisions are vanishingly rare.
  });

  it('passes when all scenarios are within the 10-point threshold', () => {
    const root = join(workdir, 'pass');
    writeReport(root, 'a-1', 'nextjs/vanilla', 85, 1);
    writeReport(root, 'a-2', 'nextjs/vanilla', 80, 2);
    writeReport(root, 'b-1', 'react-vite/vanilla', 90, 1);
    writeReport(root, 'b-2', 'react-vite/vanilla', 90, 2);
    const out = join(workdir, 'pass.json');
    const { exitCode } = runVariance(root, out);
    expect(exitCode).toBe(0);
    const summary = JSON.parse(readFileSync(out, 'utf8')) as {
      flaggedCount: number;
      scenarios: Array<{
        scenario: string;
        scoreSpread: number;
        flagged: boolean;
      }>;
    };
    expect(summary.flaggedCount).toBe(0);
    const nextjs = summary.scenarios.find(
      (s) => s.scenario === 'nextjs/vanilla',
    );
    expect(nextjs?.scoreSpread).toBe(5);
    expect(nextjs?.flagged).toBe(false);
  });

  it('flags + exits non-zero when a scenario seed-spread exceeds 10', () => {
    const root = join(workdir, 'fail');
    writeReport(root, 'a-1', 'flaky/scenario', 90, 1);
    writeReport(root, 'a-2', 'flaky/scenario', 60, 2);
    const out = join(workdir, 'fail.json');
    const { exitCode } = runVariance(root, out);
    expect(exitCode).toBe(1);
    const summary = JSON.parse(readFileSync(out, 'utf8')) as {
      flaggedCount: number;
      scenarios: Array<{
        scenario: string;
        scoreSpread: number;
        flagged: boolean;
      }>;
    };
    expect(summary.flaggedCount).toBe(1);
    expect(summary.scenarios[0].scoreSpread).toBe(30);
    expect(summary.scenarios[0].flagged).toBe(true);
  });
});
