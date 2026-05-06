/**
 * Layer 3, criterion 18 — project still builds + typechecks after
 * the wizard runs. Heavy (10 pts).
 *
 * Grades against `Artifact.buildResult` (populated by `runBuild` in
 * the runner). When buildResult is undefined, the scorer skip-passes
 * with weight 0 — typically the case on golden replays that don't
 * carry a recorded build outcome. When the live path lands in CI,
 * runBuild always produces a buildResult and this scorer participates
 * meaningfully.
 *
 * `installExitCode` is reported separately so a triage UI can
 * distinguish "lockfile drift" from "the wizard broke the build."
 */

import type { Artifact, Scenario, Scorer } from '../../runner/types.js';

export const scorer: Scorer = {
  id: 'L3-build-passes',
  layer: 3,
  criterion: 18,
  description: 'Project must still build and typecheck after the wizard runs.',
  evaluate(artifact: Artifact, _scenario: Scenario) {
    if (!artifact.buildResult) {
      return {
        pass: true,
        weight: 0,
        detail: 'no buildResult on artifact (Layer 3 not exercised this run)',
      };
    }
    const { exitCode, installExitCode, stderrTail, durationMs } =
      artifact.buildResult;
    if (exitCode === 0) {
      return { pass: true, weight: 10, detail: `build ok in ${durationMs}ms` };
    }
    if (installExitCode !== undefined && installExitCode !== 0) {
      return {
        pass: false,
        weight: 10,
        detail: `install failed (exit ${installExitCode}) — likely lockfile drift, not a wizard regression. tail:\n${stderrTail}`,
      };
    }
    return {
      pass: false,
      weight: 10,
      detail: `build failed (exit ${exitCode}). tail:\n${stderrTail}`,
    };
  },
};
