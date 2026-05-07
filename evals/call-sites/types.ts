/**
 * Per-call-site evaluation types.
 *
 * Per §7.4 of MIGRATION_PLAN.md, call-site evals reuse PR #560's
 * `Scorer` shape from `evals/runner/types.ts`. We do **not** invent a
 * second scorer interface — drift between the two would defeat the
 * "shared `score()` function" promise the plan is built on. What this
 * module adds is the *envelope* a call-site fixture produces, plus a
 * narrow `CallSiteArtifact` that scorers can consume directly without
 * forcing them to read from the full `Artifact` (which assumes a
 * filesystem snapshot scorers at this layer don't need).
 *
 * Both `Artifact` and `CallSiteArtifact` flow through the same
 * `Scorer.evaluate` signature; the call-site path just stuffs the
 * narrower shape behind the same interface.
 */

import type {
  Artifact,
  Scorer as RunnerScorer,
  ScorerResult,
} from '../runner/types.js';

/** Re-export so call-site scorers import from one place. */
export type { ScorerResult } from '../runner/types.js';

/**
 * Fixture envelope written to `fixture.json` per call site.
 *
 * Fields are intentionally loose: each call site decides what context
 * it needs to replay. The runner only enforces the meta block (id,
 * call-site name, model tier, kind).
 */
export interface CallSiteFixture {
  /** Stable fixture identifier — typically `<call-site-id>-<variant>`. */
  id: string;
  /** Call-site ID this fixture targets. Must match registry. */
  callSiteId: string;
  /** Human-readable description for triagers. */
  description: string;
  /**
   * Model tier this fixture exercises. `oneshot` fixtures can be
   * evaluated against a mocked LLM response; `streaming` fixtures
   * require either a recorded golden or a live capture.
   */
  kind: 'structured-output' | 'tool-decision' | 'streaming';
  /** Free-form input context — the prompt, the prior tool outputs, etc. */
  input: Record<string, unknown>;
  /**
   * For structured-output and tool-decision fixtures, the recorded
   * model response we score against. For streaming fixtures the
   * recorded artifact lives in `golden.ndjson` next to the fixture.
   */
  recordedOutput?: unknown;
}

/**
 * Narrow artifact a call-site scorer evaluates. The "structured"
 * branch carries the parsed model response; the "streaming" branch
 * mirrors `Artifact` so cross-cutting layered scorers can run on it.
 */
export interface CallSiteArtifact {
  /** ULID-ish run identifier (matches `Artifact.runId` shape). */
  runId: string;
  /** Echoed from the fixture so reports surface which fixture ran. */
  fixtureId: string;
  /** Echoed from the registry. */
  callSiteId: string;
  /** When this artifact was produced. */
  finishedAt: string;
  /** Source: live LLM call vs. recorded golden replay. */
  source: 'live' | 'golden' | 'mock';
  /**
   * For structured-output / tool-decision call sites, the parsed
   * model output. For streaming call sites, the parsed NDJSON slice
   * (already split into `Artifact.runLog`-shaped events).
   */
  output: unknown;
}

/**
 * Call-site scorer. Same shape as `runner/types.ts: Scorer` but with
 * a narrower argument type — the call-site path doesn't need
 * `fsSnapshot` / `stderr`, and forcing it through `Artifact` would
 * just wrap empty stubs.
 */
export interface CallSiteScorer {
  id: string;
  /**
   * For structured-output sites this is layer 1 (structural); for
   * streaming sites it can range 0–6 like the runner scorers.
   */
  layer: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  description: string;
  evaluate: (
    artifact: CallSiteArtifact,
    fixture: CallSiteFixture,
  ) => ScorerResult;
}

/**
 * Adapter: lift a `CallSiteScorer` to the runner's `Scorer` shape so
 * the same `score()` function can run it. The lifted scorer reads
 * `artifact.runLog`-shaped data only — fs/stderr fields are ignored.
 *
 * NOT used by the unit tests below (which call `evaluate` directly),
 * but exported for §7.4's "shared score() function" promise.
 */
export function liftToRunnerScorer(
  callSiteScorer: CallSiteScorer,
  fixture: CallSiteFixture,
  criterion = 0,
): RunnerScorer {
  return {
    id: callSiteScorer.id,
    layer: callSiteScorer.layer,
    criterion,
    description: callSiteScorer.description,
    evaluate(artifact: Artifact) {
      const csArtifact: CallSiteArtifact = {
        runId: artifact.runId,
        fixtureId: fixture.id,
        callSiteId: fixture.callSiteId,
        finishedAt: artifact.finishedAt,
        source: artifact.source as 'live' | 'golden' | 'mock',
        output: artifact.runLog,
      };
      return callSiteScorer.evaluate(csArtifact, fixture);
    },
  };
}
