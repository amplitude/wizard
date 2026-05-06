/**
 * Scorer orchestrator.
 *
 * Runs the scorer stack against an artifact + scenario and produces a
 * structured JSON report. Layer 0 hard-fails short-circuit downstream
 * layers — by spec, a hard fail means "the integration is broken,
 * don't burn cycles grading further."
 *
 * Week 1 scope: Layers 0 and 1 only. Layers 2 (static), 3 (build),
 * 4 (runtime), 5 (ingestion) and 6 (judge) are stubbed at the layer
 * level and surfaced in the report as "skipped: not yet implemented"
 * so triagers can see the eventual coverage shape today.
 */

import type {
  Artifact,
  Report,
  ScoredEntry,
  Scenario,
  Scorer,
} from './types.js';

import { scorer as l0NoHardcodedKey } from '../scorers/layer0-hard-fail/no-hardcoded-key.js';
import { scorer as l0CorrectSdk } from '../scorers/layer0-hard-fail/correct-sdk-package.js';
import { scorer as l0SingleInit } from '../scorers/layer0-hard-fail/single-init-call.js';
import { scorer as l0NoBuildBridging } from '../scorers/layer0-hard-fail/no-build-config-bridging.js';
import { scorer as l0NoSecretInStderr } from '../scorers/layer0-hard-fail/no-secret-in-stderr.js';

import { scorer as l1FileTouched } from '../scorers/layer1-structural/file-touched.js';
import { scorer as l1ImportPresent } from '../scorers/layer1-structural/import-present.js';
import { scorer as l1InitCallPresent } from '../scorers/layer1-structural/init-call-present.js';
import { scorer as l1EnvVarPrefix } from '../scorers/layer1-structural/env-var-prefix.js';
import { scorer as l1SetupCompleteShape } from '../scorers/layer1-structural/setup-complete-shape.js';
import { scorer as l1ExitCodeMatches } from '../scorers/layer1-structural/exit-code-matches-outcome.js';
import { scorer as l1ConfirmedEventsTracked } from '../scorers/layer1-structural/confirmed-events-tracked.js';

/**
 * The full scorer stack. Order matters — Layer 0 runs first; if any
 * Layer 0 scorer hard-fails, downstream layers are skipped.
 */
export const SCORERS: Scorer[] = [
  // Layer 0 — hard-fail gate.
  l0NoHardcodedKey,
  l0CorrectSdk,
  l0SingleInit,
  l0NoBuildBridging,
  l0NoSecretInStderr,
  // Layer 1 — structural assertions.
  l1FileTouched,
  l1ImportPresent,
  l1InitCallPresent,
  l1EnvVarPrefix,
  l1SetupCompleteShape,
  l1ExitCodeMatches,
  l1ConfirmedEventsTracked,
];

export interface ScoreOptions {
  artifact: Artifact;
  scenario: Scenario;
  /**
   * Working directory the scorers should read file content from.
   * For live runs this is the freshly-applied working tree; for
   * golden replays this is `<scenarioDir>/golden/working/`. Set on
   * `process.env.EVALS_WORKING_DIR` so per-scorer modules don't
   * need to be plumbed individually — they're pure CommonJS-ish
   * functions and reading from env keeps them composable.
   */
  workingDir: string;
}

/**
 * Run the scorer stack and produce a {@link Report}. Pure with
 * respect to the artifact (no mutations); side-effects limited to
 * setting the EVALS_WORKING_DIR env var for the duration of the call.
 */
export function score(options: ScoreOptions): Report {
  const { artifact, scenario, workingDir } = options;
  const startedAt = new Date().toISOString();

  const previousWorkingDir = process.env.EVALS_WORKING_DIR;
  process.env.EVALS_WORKING_DIR = workingDir;

  const scores: ScoredEntry[] = [];
  let hardFailed = false;
  try {
    // Layer 0 first.
    for (const scorer of SCORERS.filter((s) => s.layer === 0)) {
      const result = scorer.evaluate(artifact, scenario);
      scores.push({
        scorerId: scorer.id,
        layer: scorer.layer,
        criterion: scorer.criterion,
        result,
      });
      if (result.hardFail) hardFailed = true;
    }
    // Downstream layers — only run when no Layer 0 hard fail.
    if (!hardFailed) {
      for (const scorer of SCORERS.filter((s) => s.layer === 1)) {
        const result = scorer.evaluate(artifact, scenario);
        scores.push({
          scorerId: scorer.id,
          layer: scorer.layer,
          criterion: scorer.criterion,
          result,
        });
      }
    } else {
      for (const scorer of SCORERS.filter((s) => s.layer === 1)) {
        scores.push({
          scorerId: scorer.id,
          layer: scorer.layer,
          criterion: scorer.criterion,
          result: {
            pass: false,
            weight: 0,
            detail: 'skipped: Layer 0 hard fail short-circuited the run',
          },
        });
      }
    }
  } finally {
    if (previousWorkingDir === undefined) {
      delete process.env.EVALS_WORKING_DIR;
    } else {
      process.env.EVALS_WORKING_DIR = previousWorkingDir;
    }
  }

  // Sum weights for passing scorers; max is the sum of all run scorers'
  // weights regardless of pass/fail. Skipped (Layer 0-failed downstream)
  // entries contribute 0 to max — they were not actually executed.
  let totalScore = 0;
  let maxScore = 0;
  for (const entry of scores) {
    if (entry.result.detail?.startsWith('skipped:')) continue;
    maxScore += entry.result.weight;
    if (entry.result.pass) totalScore += entry.result.weight;
  }

  return {
    runId: artifact.runId,
    scenario: scenario.name,
    source: artifact.source,
    startedAt,
    finishedAt: new Date().toISOString(),
    hardFailed,
    totalScore,
    maxScore,
    scores,
  };
}
