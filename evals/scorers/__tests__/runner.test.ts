/**
 * End-to-end runner test, parameterized over every Ring 1 golden.
 *
 * For each scenario:
 *   1. Validate the scenario.json schema (fails loudly on a malformed
 *      manifest before scoring runs).
 *   2. Round-trip the recorded NDJSON through `parseStream` so we score
 *      the same wire shape the runner sees from a real spawn.
 *   3. Assert the four runner contract points (envelope version,
 *      single terminal `run_completed`, `setup_complete` matches the
 *      outcome, exit-code agreement).
 *   4. Run the scorer stack against the golden working tree and assert
 *      no Layer 0 hard fail and no Layer 1 failures — Ring 1 goldens
 *      are the suite's "framework correctness" green run.
 *
 * The scenario list is the source of truth for which goldens are kept
 * green by the suite. Adding a Ring 1 scenario that doesn't pass these
 * assertions means either the golden is wrong or the scorer needs a
 * fix; either way the dev sees it before the change lands.
 */

import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { runReplay } from '../../runner/invoke-wizard.js';
import { assertContract, parseStream } from '../../runner/parse-stream.js';
import { parseScenario } from '../../runner/scenario-schema.js';
import { score } from '../../runner/score.js';

import nextjsVanillaJson from '../../scenarios/nextjs-app-router/vanilla/scenario.json';
import nextjsVendorJson from '../../scenarios/nextjs-app-router/pre-existing-vendor/scenario.json';
import rr7FrameworkJson from '../../scenarios/react-router-7/framework/scenario.json';
import rr7DataJson from '../../scenarios/react-router-7/data/scenario.json';
import reactViteJson from '../../scenarios/react-vite/vanilla/scenario.json';
import expoJson from '../../scenarios/expo/vanilla/scenario.json';
import genericJson from '../../scenarios/generic/probe/scenario.json';

const SCENARIOS_ROOT = resolve(__dirname, '..', '..', 'scenarios');

interface FixtureCase {
  /** Sub-path under `evals/scenarios/` (e.g. `nextjs-app-router/vanilla`). */
  dir: string;
  /** Imported `scenario.json` payload for schema validation. */
  json: unknown;
}

const RING_1_FIXTURES: FixtureCase[] = [
  { dir: 'nextjs-app-router/vanilla', json: nextjsVanillaJson },
  { dir: 'nextjs-app-router/pre-existing-vendor', json: nextjsVendorJson },
  { dir: 'react-router-7/framework', json: rr7FrameworkJson },
  { dir: 'react-router-7/data', json: rr7DataJson },
  { dir: 'react-vite/vanilla', json: reactViteJson },
  { dir: 'expo/vanilla', json: expoJson },
  { dir: 'generic/probe', json: genericJson },
];

describe.each(RING_1_FIXTURES)(
  'eval runner — Ring 1 golden replay: $dir',
  ({ dir, json }) => {
    const scenarioDir = resolve(SCENARIOS_ROOT, dir);
    const scenario = parseScenario(json);

    it('produces a contract-clean artifact and passes Layer 0 + Layer 1', () => {
      const { artifact, workingDir } = runReplay({ scenario, scenarioDir });

      const ndjson = artifact.runLog.map((e) => JSON.stringify(e)).join('\n');
      const parsed = parseStream(ndjson);

      expect(parsed.parseErrors).toEqual([]);
      expect(parsed.runCompleted).toBeDefined();
      expect(parsed.setupComplete).toBeDefined();

      const contract = assertContract(parsed, artifact.exitCode);
      expect(contract.violations).toEqual([]);
      expect(contract.ok).toBe(true);

      // Replay returns the absolute path to golden/working — guard
      // against a future drift in the runner that routes replays to a
      // tmpdir and breaks scorers' file-content reads.
      expect(workingDir).toBe(resolve(scenarioDir, 'golden', 'working'));

      const report = score({ artifact, scenario, workingDir });
      expect(report.hardFailed).toBe(false);

      // Every Layer 0 and Layer 1 scorer must pass on a Ring 1 golden.
      const failures = report.scores.filter(
        (s) => (s.layer === 0 || s.layer === 1) && !s.result.pass,
      );
      expect(failures).toEqual([]);

      // Sum-of-weights sanity floor: Layer 1 contributes 50 across its
      // weighted scorers (file-touched=10, import-present=10,
      // init-call-present=5, env-var-prefix=5, setup-complete-shape=5,
      // exit-code-matches=5, confirmed-events-tracked=10) plus Layer 2
      // adds 35 more (criteria 2/3/7/11/12 weighted, 15 soft-warn=0).
      // Floor stays at 45 so a single missing scorer trips the
      // assertion without requiring this number to track every layer
      // addition.
      expect(report.maxScore).toBeGreaterThanOrEqual(45);
      expect(report.totalScore).toBe(report.maxScore);
    });
  },
);
