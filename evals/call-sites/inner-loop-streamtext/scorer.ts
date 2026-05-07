/**
 * Scorer for the `inner-loop-streamtext` call site.
 *
 * Per MIGRATION_PLAN.md §7.4, streaming sites get a layered (L0/L1)
 * check on the resulting NDJSON slice. We don't re-implement the
 * runner's layered scorers — instead we apply two cheap structural
 * assertions directly here, and rely on `liftToRunnerScorer` (in
 * `evals/call-sites/types.ts`) to feed the artifact into the full
 * runner stack when callers want deeper coverage.
 *
 * Bundled checks:
 *
 *   - L0: every event carries `v: 1` (wire-version invariant). A
 *     mid-stream version flip is a hard fail.
 *   - L1: the slice contains exactly one terminal `run_completed`
 *     and a `setup_complete` whose outcome agrees with it.
 *
 * Anything richer (file-touched, env-var-prefix, confirmed-events-
 * tracked) is the job of the existing runner scorers and will land
 * once `liftToRunnerScorer` is wired into the registry runner.
 */

import type {
  CallSiteArtifact,
  CallSiteFixture,
  CallSiteScorer,
  ScorerResult,
} from '../types.js';

interface NdjsonEvent {
  v?: number;
  type?: string;
  message?: string;
  data?: { event?: string; outcome?: string };
}

function isNdjsonEvent(x: unknown): x is NdjsonEvent {
  return !!x && typeof x === 'object';
}

export const scorer: CallSiteScorer = {
  id: 'CS-inner-loop-streamtext-shape',
  layer: 1,
  description:
    'inner-loop streamText slice must carry v:1 on every event, exactly one run_completed, and setup_complete outcome agreeing with it.',
  evaluate(
    artifact: CallSiteArtifact,
    _fixture: CallSiteFixture,
  ): ScorerResult {
    if (!Array.isArray(artifact.output)) {
      return {
        pass: false,
        weight: 10,
        detail: 'streaming-site output must be an array of NDJSON events',
      };
    }

    const events = artifact.output.filter(isNdjsonEvent);

    if (events.length === 0) {
      return {
        pass: false,
        weight: 10,
        detail: 'no NDJSON events in the slice',
      };
    }

    // L0: wire-version invariant.
    for (let i = 0; i < events.length; i++) {
      if (events[i].v !== 1) {
        return {
          pass: false,
          hardFail: true,
          weight: 10,
          detail: `event ${i} has v=${events[i].v ?? 'undefined'}, expected 1`,
        };
      }
    }

    // L1: exactly one run_completed.
    const runCompleted = events.filter(
      (e) => e.message === 'run_completed' || e.data?.event === 'run_completed',
    );
    if (runCompleted.length !== 1) {
      return {
        pass: false,
        weight: 10,
        detail: `expected exactly one run_completed event, got ${runCompleted.length}`,
      };
    }

    // L1: setup_complete present and agrees with run_completed outcome.
    const setupComplete = events.find(
      (e) =>
        e.message === 'setup_complete' || e.data?.event === 'setup_complete',
    );
    if (!setupComplete) {
      return {
        pass: false,
        weight: 10,
        detail: 'missing setup_complete event',
      };
    }
    const setupOutcome = setupComplete.data?.outcome;
    const runOutcome = runCompleted[0].data?.outcome;
    if (setupOutcome !== runOutcome) {
      return {
        pass: false,
        weight: 10,
        detail: `setup_complete outcome="${
          setupOutcome ?? 'undefined'
        }" disagrees with run_completed outcome="${runOutcome ?? 'undefined'}"`,
      };
    }

    return { pass: true, weight: 10 };
  },
};
