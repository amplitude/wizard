/**
 * End-to-end test for the eval runner: load the Ring 1 nextjs-app-router/
 * vanilla scenario, score it against the recorded golden artifact, and
 * assert that the runner contract holds, no Layer 0 hard fail fires, and
 * every Layer 1 scorer passes.
 *
 * This is the "framework being correct" green run for Week 1. Once the
 * eval-only Amplitude project lands and we can run a real wizard end-to-
 * end, a sibling `runner.live.test.ts` will exercise the live path.
 */

import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { runReplay } from '../../runner/invoke-wizard.js';
import { assertContract, parseStream } from '../../runner/parse-stream.js';
import { score } from '../../runner/score.js';
import type { Scenario } from '../../runner/types.js';
import scenarioJson from '../../scenarios/nextjs-app-router/vanilla/scenario.json';

const scenarioDir = resolve(
  __dirname,
  '..',
  '..',
  'scenarios',
  'nextjs-app-router',
  'vanilla',
);
const scenario = scenarioJson as Scenario;

describe('eval runner — nextjs-app-router/vanilla golden replay', () => {
  it('produces a contract-clean artifact and a clean Layer 0 + Layer 1 score', () => {
    const artifact = runReplay({ scenario, scenarioDir });

    // Round-trip the events through parseStream so we score the same
    // wire shape the runner sees from a real spawn.
    const ndjson = artifact.runLog.map((e) => JSON.stringify(e)).join('\n');
    const parsed = parseStream(ndjson);

    expect(parsed.parseErrors).toEqual([]);
    expect(parsed.runCompleted).toBeDefined();
    expect(parsed.setupComplete).toBeDefined();

    const contract = assertContract(parsed, artifact.exitCode);
    expect(contract.violations).toEqual([]);
    expect(contract.ok).toBe(true);

    const workingDir = resolve(scenarioDir, 'golden', 'working');
    const report = score({ artifact, scenario, workingDir });

    expect(report.hardFailed).toBe(false);
    // Every Layer 1 scorer must pass on the golden artifact.
    const failures = report.scores.filter(
      (s) => s.layer === 1 && !s.result.pass,
    );
    expect(failures).toEqual([]);
    // Sum-of-weights sanity floor: the four Layer 1 weighted scorers
    // (file-touched=10, import-present=10, init-call-present=5,
    // env-var-prefix=5, setup-complete-shape=5, exit-code-matches=5,
    // confirmed-events-tracked=10) total 50.
    expect(report.maxScore).toBeGreaterThanOrEqual(45);
    expect(report.totalScore).toBe(report.maxScore);
  });
});
