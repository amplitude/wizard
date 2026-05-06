/**
 * Eval runner — spawns the wizard binary, captures the NDJSON stream, builds
 * an Artifact, and dispatches scorers.
 *
 * This is the spine. It does not import wizard internals beyond shared types
 * (`AgentEventEnvelope`, `ExitCode`) — everything else is observed via the
 * --agent NDJSON contract.
 *
 * Status: SCAFFOLD. The skeleton wires every step end-to-end against a single
 * scenario but `runScenario` is intentionally minimal — fixture
 * pristine/working copy, build-step execution, and report writing are
 * marked TODO so a follow-up PR can layer them in without restructuring.
 */
import { spawn } from 'node:child_process';
import { mkdir, rm, cp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { AgentEventEnvelope } from '../../src/lib/agent-events.js';
import { assertRunContract, parseEnvelope } from './contract.js';
import { diffSnapshots, snapshotDirectory } from './fs-snapshot.js';
import { getScorers } from './scorer-registry.js';
import type {
  Artifact,
  LayerId,
  ReportSummary,
  Scenario,
  ScorerOutcome,
  ScorerResult,
} from './types.js';

const REPO_ROOT = resolve(__dirname, '..', '..');
const FIXTURES_ROOT = join(REPO_ROOT, 'evals', 'fixtures');
const REPORTS_ROOT = join(REPO_ROOT, 'evals', 'reports');

export interface RunOptions {
  scenario: Scenario;
  layers: LayerId[];
  seed: number;
  /** API key string injected via `--api-key`. Required. */
  apiKey: string;
  /** Path to the wizard binary. Defaults to `dist/bin.js`. */
  wizardBin?: string;
}

export async function runScenario(opts: RunOptions): Promise<ReportSummary> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const fixtureRoot = join(FIXTURES_ROOT, opts.scenario.fixture);
  const pristine = join(fixtureRoot, 'pristine');
  const working = join(fixtureRoot, 'working');

  if (!existsSync(pristine)) {
    throw new Error(
      `fixture pristine/ missing for scenario ${opts.scenario.name}: ${pristine}`,
    );
  }

  // Reset working/ from pristine/ for a clean run. (Keep CI cache-friendly:
  // the rm/cp pair is fine for small fixtures; switch to overlayfs if total
  // fixture size grows past ~200 MB.)
  await rm(working, { recursive: true, force: true });
  await cp(pristine, working, { recursive: true });

  const baseline = await snapshotDirectory(pristine);

  const wizardBin = opts.wizardBin ?? join(REPO_ROOT, 'dist', 'bin.js');
  const argv = [
    wizardBin,
    '--agent',
    '--yes',
    '--install-dir',
    working,
    '--integration',
    opts.scenario.integrationHint,
    '--api-key',
    opts.apiKey,
  ];

  const t0 = Date.now();
  const { runLog, exitCode, rawOutput } = await spawnWizard(argv);
  const durationMs = Date.now() - t0;

  // Contract assertions — runner-level errors short-circuit scoring.
  const violations = assertRunContract({
    runLog,
    exitCode,
    rawOutput,
    apiKey: opts.apiKey,
  });
  if (violations.length > 0) {
    const summary: ReportSummary = {
      runId,
      scenario: opts.scenario.name,
      ring: opts.scenario.ring,
      exitCode,
      hardFail: true,
      totalScore: 0,
      maxScore: 0,
      passed: false,
      outcomes: violations.map((v) => ({
        id: `contract-${v.kind}`,
        criterion: 0,
        skipped: true,
        reason: 'other',
      })),
    };
    await writeReport(runId, summary, { runLog, violations });
    return summary;
  }

  const after = await snapshotDirectory(working);
  const fsSnapshot = { ...after, diff: diffSnapshots(baseline, after) };

  const artifact: Artifact = {
    runId,
    scenario: opts.scenario.name,
    ring: opts.scenario.ring,
    seed: opts.seed,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode,
    durationMs,
    runLog,
    fsSnapshot,
    scenarioDef: opts.scenario,
    apiKey: opts.apiKey,
  };

  const outcomes = dispatchScorers(artifact, opts.layers);
  const summary = summarize(runId, opts.scenario, outcomes, exitCode);
  await writeReport(runId, summary, { runLog, artifact });
  return summary;
}

interface SpawnResult {
  runLog: AgentEventEnvelope[];
  exitCode: number;
  /** Raw stdout+stderr bytes. Used by the secret-leak grep in contract.ts. */
  rawOutput: string;
}

async function spawnWizard(argv: string[]): Promise<SpawnResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, argv, { stdio: 'pipe' });
    const runLog: AgentEventEnvelope[] = [];
    let stdoutBuf = '';
    let rawOutput = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      rawOutput += chunk;
      stdoutBuf += chunk;
      let idx: number;
      while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, idx);
        stdoutBuf = stdoutBuf.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          runLog.push(parseEnvelope(line));
        } catch {
          // Surfaced as a contract violation later; preserve in rawOutput.
        }
      }
    });
    child.stderr.on('data', (chunk: string) => {
      rawOutput += chunk;
    });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      // Drain any tail line (no trailing newline).
      if (stdoutBuf.trim()) {
        try {
          runLog.push(parseEnvelope(stdoutBuf));
        } catch {
          /* contract violation surfaced later */
        }
      }
      resolvePromise({ runLog, exitCode: code ?? -1, rawOutput });
    });
  });
}

function dispatchScorers(
  artifact: Artifact,
  layers: LayerId[],
): ScorerOutcome[] {
  const outcomes: ScorerOutcome[] = [];
  let hardFailed = false;
  for (const scorer of getScorers(layers)) {
    if (hardFailed) {
      outcomes.push({
        id: scorer.id,
        criterion: scorer.criterion,
        skipped: true,
        reason: 'hard_fail_upstream',
      });
      continue;
    }
    try {
      const result = scorer.evaluate(artifact);
      outcomes.push(result);
      if (!result.pass && result.hardFail) hardFailed = true;
    } catch (err) {
      outcomes.push({
        id: scorer.id,
        criterion: scorer.criterion,
        pass: false,
        weight: 0,
        detail: `scorer threw: ${
          err instanceof Error ? err.message : String(err)
        }`,
      } satisfies ScorerResult);
    }
  }
  return outcomes;
}

function summarize(
  runId: string,
  scenario: Scenario,
  outcomes: ScorerOutcome[],
  exitCode: number,
): ReportSummary {
  let totalScore = 0;
  let maxScore = 0;
  let hardFail = false;
  for (const outcome of outcomes) {
    if ('skipped' in outcome) continue;
    const weight = outcome.weight ?? 0;
    maxScore += weight;
    if (outcome.pass) totalScore += weight;
    if (!outcome.pass && outcome.hardFail) hardFail = true;
  }
  const passed = !hardFail && (maxScore === 0 || totalScore / maxScore >= 0.8);
  return {
    runId,
    scenario: scenario.name,
    ring: scenario.ring,
    exitCode,
    hardFail,
    totalScore,
    maxScore,
    passed,
    outcomes,
  };
}

async function writeReport(
  runId: string,
  summary: ReportSummary,
  detail: object,
): Promise<void> {
  const dir = join(REPORTS_ROOT, runId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'summary.json'),
    JSON.stringify(summary, null, 2),
    'utf8',
  );
  await writeFile(
    join(dir, 'detail.json'),
    JSON.stringify(detail, null, 2),
    'utf8',
  );
}
