#!/usr/bin/env -S node --import=tsx
/**
 * `pnpm evals:run <scenario>` entrypoint.
 *
 * Resolves a scenario by path under `evals/scenarios/`, picks the
 * artifact source (live spawn vs. golden replay), runs the scorer
 * stack, and writes a JSON report under `evals/reports/<runId>/`.
 *
 * Source selection (Week 1):
 *
 *   - If `--live` is passed, attempt to spawn the wizard. Requires
 *     `AMPLITUDE_WIZARD_API_KEY` (or `AMPLITUDE_EVAL_API_KEY`) to be
 *     set. Bail out early with a clear message if not.
 *   - Otherwise, default to golden replay if `golden/` exists.
 *   - If neither path is viable, exit non-zero with a message that
 *     names what's missing.
 *
 * Why default to golden: in Week 1 the eval-only Amplitude project is
 * not provisioned yet. Defaulting to live would force every CI run to
 * surface the missing-key error. Golden gets the green run; live is
 * available for whoever has a key on hand.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { runLive, runReplay } from '../runner/invoke-wizard.js';
import { assertContract, parseStream } from '../runner/parse-stream.js';
import { score } from '../runner/score.js';
import type { Scenario } from '../runner/types.js';

interface CliArgs {
  scenarioId: string;
  live: boolean;
  /** When set, write reports under this dir; default `evals/reports/`. */
  reportsDir?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { scenarioId: '', live: false };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--live') args.live = true;
    else if (a === '--reports-dir') args.reportsDir = argv[++i];
    else if (a.startsWith('--')) {
      throw new Error(`unknown flag: ${a}`);
    } else rest.push(a);
  }
  if (rest.length !== 1) {
    throw new Error(
      'usage: pnpm evals:run <scenario-id> [--live] [--reports-dir <path>]',
    );
  }
  args.scenarioId = rest[0];
  return args;
}

function loadScenario(scenarioDir: string): Scenario {
  const path = join(scenarioDir, 'scenario.json');
  if (!existsSync(path)) {
    throw new Error(`scenario.json missing: ${path}`);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Scenario;
}

async function main() {
  // Resolve repoRoot from the script's own path so the CLI works when
  // invoked from any cwd. `process.argv[1]` is the running script path
  // under tsx; fall back to cwd if argv[1] is absent (rare).
  const scriptPath = process.argv[1] ?? process.cwd();
  const here = dirname(scriptPath);
  const repoRoot = resolve(here, '..', '..');
  const args = parseArgs(process.argv.slice(2));
  const scenarioDir = resolve(repoRoot, 'evals', 'scenarios', args.scenarioId);
  if (!existsSync(scenarioDir)) {
    throw new Error(`scenario dir does not exist: ${scenarioDir}`);
  }
  const scenario = loadScenario(scenarioDir);

  // Pick a source.
  const goldenDir = join(scenarioDir, 'golden');
  const hasGolden = existsSync(goldenDir);
  const useLive = args.live;
  if (useLive) {
    const apiKey =
      process.env.AMPLITUDE_EVAL_API_KEY ??
      process.env.AMPLITUDE_WIZARD_API_KEY;
    if (!apiKey) {
      console.error(
        'live mode requires AMPLITUDE_EVAL_API_KEY (or AMPLITUDE_WIZARD_API_KEY). ' +
          'Falling back is not safe in live mode — exiting.',
      );
      process.exit(2);
    }
  } else if (!hasGolden) {
    console.error(
      `no golden artifact at ${goldenDir} and --live not requested; nothing to score.`,
    );
    process.exit(2);
  }

  // Build the artifact.
  const artifact = useLive
    ? await runLive({
        scenario,
        scenarioDir,
        repoRoot,
        apiKey:
          process.env.AMPLITUDE_EVAL_API_KEY ??
          process.env.AMPLITUDE_WIZARD_API_KEY,
      })
    : runReplay({ scenario, scenarioDir });

  // Re-parse the run log + assert contract on the assembled artifact.
  // (parseStream + assertContract is also called inside the runner, but
  // for live runs we want a single canonical block of contract violations
  // attached to the report.)
  const ndjson = artifact.runLog.map((e) => JSON.stringify(e)).join('\n');
  const parsed = parseStream(ndjson);
  const contract = assertContract(parsed, artifact.exitCode);

  // Score.
  const workingDir = useLive
    ? join(scenarioDir, 'working')
    : join(scenarioDir, 'golden', 'working');
  const report = score({ artifact, scenario, workingDir });

  // Write the report.
  const reportsRoot = args.reportsDir ?? resolve(repoRoot, 'evals', 'reports');
  const runDir = join(reportsRoot, artifact.runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, 'report.json'),
    JSON.stringify(
      {
        ...report,
        contract,
        artifact: {
          runId: artifact.runId,
          scenario: artifact.scenario,
          source: artifact.source,
          exitCode: artifact.exitCode,
          startedAt: artifact.startedAt,
          finishedAt: artifact.finishedAt,
          fsDiff: artifact.fsSnapshot.diff,
        },
      },
      null,
      2,
    ),
  );

  // Console summary for the contributor running this locally.
  console.log(
    JSON.stringify(
      {
        scenario: scenario.name,
        source: artifact.source,
        hardFailed: report.hardFailed,
        totalScore: report.totalScore,
        maxScore: report.maxScore,
        contractOk: contract.ok,
        reportPath: join(runDir, 'report.json'),
      },
      null,
      2,
    ),
  );

  // Exit non-zero on hard fail or contract violation so CI fails the
  // build. A soft-fail (low score) currently exits zero — Week 2 will
  // promote that to a configurable threshold.
  if (report.hardFailed || !contract.ok) process.exit(1);
}

main().catch((err) => {
  console.error('eval run failed:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
