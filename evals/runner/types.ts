/**
 * Shared types for the eval runner and scorers.
 *
 * The runner produces an `Artifact` per scenario run. Scorers consume the
 * artifact and never touch the live filesystem — this is what lets us
 * re-score historical runs without re-spawning the wizard.
 *
 * See docs/evals.md § "Architecture overview" for the full contract.
 */
import type { Integration } from '../../src/lib/constants.js';
import type { AgentEventEnvelope } from '../../src/lib/agent-events.js';

export type Ring = 1 | 2 | 3;

export type LayerId = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Declarative scenario definition. Lives at `evals/scenarios/<name>.scenario.ts`
 * and is consumed by the runner. Adding fields here should be rare — most new
 * checks should be expressed by adding a scorer, not by extending Scenario.
 */
export interface Scenario {
  name: string;
  ring: Ring;
  /** Directory name under `evals/fixtures/`. */
  fixture: string;
  integrationHint: Integration;
  /** argv to run for the build / typecheck check (Layer 3). */
  buildCommand: string[];
  /** Expected SDK package family — fed to criterion 1 scorer. */
  expectedSdkPackage: string;
  /** Framework env-var prefix — fed to criterion 9 scorer. */
  expectedEnvPrefix: string;
  /** Path (relative to fixture working/) where init() should land — criterion 4. */
  expectedInitFile: string;
  /** Events the scenario expects to flow through the agent's plan. */
  expectedEvents: string[];
  /**
   * Files the agent must NOT touch — used by criterion 10 (no build-config
   * bridging). Path globs evaluated relative to fixture working/.
   */
  forbiddenPaths: string[];
  /** Free-form note for humans triaging failures. */
  notes?: string;
}

/**
 * One scorer verdict. Returned from `Scorer.evaluate()` and recorded in the
 * artifact's report file.
 */
export interface ScorerResult {
  /** Stable id — `L<layer>-<kebab-case>`, e.g. `L0-no-hardcoded-key`. */
  id: string;
  /** Row number in the 19-point checklist this scorer covers. */
  criterion: number;
  pass: boolean;
  /** Whether this verdict is a hard fail per the spec. */
  hardFail?: boolean;
  /** Point weight (10 / 5 / 0-soft). Zero means warn-only. */
  weight?: number;
  /** Human-readable detail when pass=false. Redacted by the runner. */
  detail?: string;
  /** Optional file path + line for triage UX. */
  evidence?: { path?: string; lineStart?: number; lineEnd?: number };
}

/**
 * Skip reason for a scorer that did not run (upstream short-circuit, layer
 * gated off by ring, etc). Distinct from a fail so triage can ignore it.
 */
export interface ScorerSkipped {
  id: string;
  criterion: number;
  skipped: true;
  reason: 'hard_fail_upstream' | 'layer_disabled' | 'build_failed' | 'other';
}

export type ScorerOutcome = ScorerResult | ScorerSkipped;

/**
 * The shared input passed to every scorer. Scorers must never read from disk
 * outside `artifact.fsSnapshot` and never read the live runLog stream — only
 * the captured array on the artifact.
 */
export interface Artifact {
  runId: string;
  scenario: string;
  ring: Ring;
  seed: number;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  durationMs: number;
  runLog: AgentEventEnvelope[];
  fsSnapshot: FsSnapshot;
  buildResult?: BuildResult;
  runtimeResult?: RuntimeResult;
  /** Resolved scenario for convenience — same instance the runner used. */
  scenarioDef: Scenario;
  /**
   * The eval-only API key string the runner injected. Layer 0 scorers grep
   * for this (and a 16-char prefix) across diff'd files.
   */
  apiKey: string;
}

export interface FsSnapshotFile {
  /** sha256 of the file content (hex). */
  sha256: string;
  size: number;
}

export interface FsSnapshot {
  /** Map of relative path → file metadata. Built by walking working/. */
  files: Record<string, FsSnapshotFile>;
  /** Diff against the fixture's pristine/ baseline. */
  diff: {
    added: string[];
    modified: string[];
    deleted: string[];
  };
}

export interface BuildResult {
  command: string;
  exitCode: number;
  /** Last 4kb of stderr, redacted. */
  stderrTail: string;
  durationMs: number;
}

export interface RuntimeResult {
  booted: boolean;
  uncaughtExceptions: string[];
  ingestionRequests: number;
  durationMs: number;
}

/**
 * The contract every scorer implements. `evaluate` is sync because all the
 * data it needs is on the artifact — anything async should be done in the
 * runner before scorers fire.
 */
export interface Scorer {
  id: string;
  layer: LayerId;
  criterion: number;
  evaluate(artifact: Artifact): ScorerResult;
}

/**
 * Per-run report shape — written as JSONL under `evals/reports/<runId>/`.
 */
export interface ReportSummary {
  runId: string;
  scenario: string;
  ring: Ring;
  exitCode: number;
  hardFail: boolean;
  totalScore: number;
  maxScore: number;
  passed: boolean;
  outcomes: ScorerOutcome[];
}
