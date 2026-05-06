/**
 * Shared types for the eval runner + scorer stack.
 *
 * The runner consumes a {@link Scenario}, drives the wizard (or loads a
 * pre-recorded NDJSON artifact), and produces an {@link Artifact}.
 * Scorers consume the artifact and never touch the live filesystem —
 * this is what lets us re-score historical runs without re-running the
 * wizard. See `docs/evals.md` for the full spec.
 */

import type { AgentEventEnvelope } from '../../src/lib/agent-events.js';
import type { Scenario } from './scenario-schema.js';

/**
 * Declarative scenario manifest. Re-exported from the Zod schema in
 * `scenario-schema.ts` — that module is the source of truth and
 * loaders MUST call `parseScenario` rather than typecasting raw JSON.
 * A typo in `expectedSdkPackage` (or any required field) silently
 * flips Layer 0 into a false pass otherwise.
 */
export type { Scenario } from './scenario-schema.js';

/**
 * Snapshot of the working tree after a run. Computed by walking the
 * fixture's `working/` (or, in golden-artifact mode, loaded from disk).
 */
export interface FsSnapshot {
  /** All files in the working tree, keyed by repo-relative path. */
  files: Record<string, { sha256: string; size: number }>;
  /** Diff against the fixture's pristine baseline. */
  diff: {
    added: string[];
    modified: string[];
    deleted: string[];
  };
}

/**
 * The artifact a scenario produces. Scorers consume this; they never
 * re-spawn the wizard or touch the live filesystem.
 *
 * `runLog` is what the agent intended (every NDJSON event, in order).
 * `fsSnapshot` is what actually landed on disk. Several criteria
 * compare the two — a scorer that only looks at one is incomplete.
 */
export interface Artifact {
  /** ULID-ish identifier for this run. */
  runId: string;
  scenario: string;
  ring: Scenario['ring'];
  /** Optional seed for variance tracking (Week 2+). */
  seed?: number;
  startedAt: string;
  finishedAt: string;
  /** Process exit code returned by the wizard binary. */
  exitCode: number;
  /** Every NDJSON line, parsed in order. */
  runLog: AgentEventEnvelope[];
  fsSnapshot: FsSnapshot;
  /**
   * Stderr captured from the wizard subprocess, post-redaction.
   *
   * Live runs apply `redactString` from
   * `src/lib/observability/redact.ts` to the full buffer at flush time.
   * Goldens may pin a `golden/stderr.txt`; absence is fine and yields
   * an empty string. The `no-secret-in-stderr` Layer 0 scorer treats
   * any token-shape match here as a redactor-failure hard fail.
   */
  stderr: string;
  /**
   * Source of the artifact. `live` = freshly spawned wizard. `golden`
   * = pre-recorded NDJSON + a baseline snapshot loaded from disk.
   * Useful for triage so you don't mistake a replay for a real run.
   */
  source: 'live' | 'golden';
}

/**
 * Result of one scorer evaluating one artifact.
 *
 * `pass` is the verdict. `hardFail = true` short-circuits the layer
 * stack — no downstream scorers run for this scenario. `weight` is the
 * point value from the 19-point checklist (`Heavy = 10`, `Medium = 5`,
 * `Soft` is warn-only and contributes 0).
 */
export interface ScorerResult {
  pass: boolean;
  /** Hard-fail short-circuits the whole scoring stack. */
  hardFail?: boolean;
  /** Point value when this scorer passes. 0 for warn-only. */
  weight: number;
  /** One-line reason; required when `pass === false`. */
  detail?: string;
  /** File path the failure points at (when applicable). */
  evidencePath?: string;
}

/** A scorer evaluates an {@link Artifact} against a {@link Scenario}. */
export interface Scorer {
  /** Stable ID, e.g. `L0-no-hardcoded-key`. */
  id: string;
  /** Layer this scorer belongs to (0–6 per the spec). */
  layer: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** 19-point checklist criterion this scorer covers. */
  criterion: number;
  /** One-sentence description for triage reports. */
  description: string;
  evaluate: (artifact: Artifact, scenario: Scenario) => ScorerResult;
}

/** Per-scorer entry in the JSON report. */
export interface ScoredEntry {
  scorerId: string;
  layer: number;
  criterion: number;
  result: ScorerResult;
}

/** Final per-scenario report written under `evals/reports/<run-id>/`. */
export interface Report {
  runId: string;
  scenario: string;
  source: Artifact['source'];
  startedAt: string;
  finishedAt: string;
  /** True if any hard-fail scorer fired. */
  hardFailed: boolean;
  /** Sum of `weight` for passing scorers (excluding warn-only). */
  totalScore: number;
  /** Maximum possible score across the scorers that ran. */
  maxScore: number;
  scores: ScoredEntry[];
}
