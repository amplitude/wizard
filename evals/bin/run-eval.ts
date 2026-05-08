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
import { runJudge } from '../runner/judge.js';
import { assertContract, parseStream } from '../runner/parse-stream.js';
import { runRuntimeProbe } from '../runner/runtime.js';
import { parseScenario } from '../runner/scenario-schema.js';
import { score } from '../runner/score.js';
import type { Scenario } from '../runner/types.js';

interface CliArgs {
  scenarioId: string;
  live: boolean;
  /** When set, write reports under this dir; default `evals/reports/`. */
  reportsDir?: string;
  /**
   * Override the wizard binary the runner spawns. Forwarded to
   * `runLive` as `wizardBin`. Equivalent to setting `WIZARD_BIN`
   * on the runner process; the flag wins when both are set so
   * one-off Ring 3 packaging runs don't have to mutate env.
   */
  wizardBin?: string;
  /**
   * Run the Layer 4 runtime probe after scoring. Opt-in because
   * playwright is a heavy install + boots the dev server (1-3 min per
   * scenario). Nightly + pre-release rings flip this on.
   */
  runtime: boolean;
  /**
   * Run the Layer 6 LLM judge. Opt-in because every call spends tokens
   * and adds 30-90s of wall-clock per scenario; the spec restricts this
   * to nightly Ring 2 by default. Requires `ANTHROPIC_API_KEY`.
   */
  judge: boolean;
  /**
   * Variance-tracking seed. Doesn't affect golden replay output (the
   * inputs are deterministic), but is recorded on the artifact so
   * `variance-summary.ts` can stitch same-scenario different-seed
   * reports together. Falls back to `EVAL_SEED` env var, then 1.
   */
  seed?: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    scenarioId: '',
    live: false,
    runtime: false,
    judge: false,
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--live') args.live = true;
    else if (a === '--runtime') args.runtime = true;
    else if (a === '--judge') args.judge = true;
    else if (a === '--seed') args.seed = Number.parseInt(argv[++i], 10);
    else if (a === '--reports-dir') args.reportsDir = argv[++i];
    else if (a === '--wizard-bin') args.wizardBin = argv[++i];
    else if (a.startsWith('--')) {
      throw new Error(`unknown flag: ${a}`);
    } else rest.push(a);
  }
  if (rest.length !== 1) {
    throw new Error(
      'usage: pnpm evals:run <scenario-id> [--live] [--runtime] [--judge] [--reports-dir <path>] [--wizard-bin <cmd>]',
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
  // Validate at load time so a typo in expectedSdkPackage / a missing
  // required field surfaces here rather than as a confused scorer fail
  // later. Throws ZodError with a useful path on invalid input.
  return parseScenario(JSON.parse(readFileSync(path, 'utf8')));
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
    // Auth resolution lives in `runLive` (`resolveLiveAuthMode`). We
    // pre-check here only to print a helpful pre-flight warning; the
    // runner is the source of truth and will throw if neither path is
    // configured.
    const hasOauth = !!process.env.WIZARD_OAUTH_TOKEN;
    const hasBypassOptIn = process.env.EVALS_ALLOW_API_KEY_BYPASS === '1';
    const hasApiKey = !!(
      process.env.AMPLITUDE_EVAL_API_KEY ?? process.env.AMPLITUDE_WIZARD_API_KEY
    );
    if (!hasOauth && hasBypassOptIn && hasApiKey) {
      console.warn(
        '⚠️  Live run will use --api-key (gateway-bypass mode). LLM calls go direct-to-Anthropic and will not exercise the Amplitude LLM gateway. Set WIZARD_OAUTH_TOKEN to route through the gateway once wizard-side wiring lands.',
      );
    }
  } else if (!hasGolden) {
    console.error(
      `no golden artifact at ${goldenDir} and --live not requested; nothing to score.`,
    );
    process.exit(2);
  }

  // Build the artifact. The runner returns the workingDir alongside
  // it so we don't reconstruct the path here; live runs land under
  // os.tmpdir() per runId, replays under golden/working.
  const result = useLive
    ? await runLive({
        scenario,
        scenarioDir,
        repoRoot,
        apiKey:
          process.env.AMPLITUDE_EVAL_API_KEY ??
          process.env.AMPLITUDE_WIZARD_API_KEY,
        wizardBin: args.wizardBin,
      })
    : runReplay({ scenario, scenarioDir });
  const { artifact, workingDir, cleanup } = result;

  // Stamp the variance-tracking seed onto the artifact so
  // `variance-summary.ts` can stitch same-scenario reports together.
  // Default to 1 when neither flag nor env var was supplied.
  const seedFromEnv = process.env.EVAL_SEED
    ? Number.parseInt(process.env.EVAL_SEED, 10)
    : undefined;
  artifact.seed = args.seed ?? (Number.isFinite(seedFromEnv) ? seedFromEnv : 1);

  // Re-parse the run log + assert contract on the assembled artifact.
  // (parseStream + assertContract is also called inside the runner, but
  // for live runs we want a single canonical block of contract violations
  // attached to the report.)
  const ndjson = artifact.runLog.map((e) => JSON.stringify(e)).join('\n');
  const parsed = parseStream(ndjson);
  const contract = assertContract(parsed, artifact.exitCode);

  // Optionally run the Layer 4 runtime probe BEFORE scoring so the
  // result rides on the artifact. Probe boots a dev server inside
  // workingDir, which means it must run before cleanup. Skipped when
  // `--runtime` is absent or the scenario doesn't declare a
  // `runtimeProbe` config — the L4 scorer skip-passes with weight 0
  // either way.
  if (args.runtime && scenario.runtimeProbe) {
    artifact.runtimeResult = await runRuntimeProbe({ scenario, workingDir });
  }

  // Optionally run the Layer 6 LLM judge. Costs tokens + 30-90s of
  // wall-clock per scenario; the spec restricts this to opt-in PR runs
  // (`evals:full` label / `[evals]` trigger) and nightly Ring 2.
  if (args.judge) {
    artifact.judgeResult = await runJudge({ scenario, artifact, workingDir });
  }

  // Score against the workingDir the runner returned, then tear it
  // down. The try/finally guarantees cleanup runs even if a scorer
  // throws — without it, a single bad scorer would leak per-run
  // tmpdirs across the whole eval suite.
  let report;
  try {
    report = score({ artifact, scenario, workingDir });
  } finally {
    cleanup();
  }

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
          seed: artifact.seed,
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
