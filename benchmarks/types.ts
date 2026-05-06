/**
 * Shared types for the wizard performance benchmark harness.
 *
 * The harness validates the migration plan's performance claims that
 * the in-tree benchmarks (src/lib/middleware/benchmarks/) do not cover —
 * those are runtime per-turn telemetry trackers; this is the offline
 * harness for prompt-cache hit-rate, system-prefix token reduction,
 * first-token latency, bundle-size delta, and per-tool execution time.
 *
 * See benchmarks/README.md for context.
 */

export type BenchmarkStatus =
  | 'ok'
  | 'skipped'
  | 'regressed'
  | 'improved'
  | 'warn';

export interface BenchmarkResult {
  /** Stable benchmark id, e.g. "prefix-size", "bundle-size". */
  id: string;
  /** Human-readable label printed in the markdown table. */
  label: string;
  /**
   * Numeric "before" value. Optional — for some benchmarks (latency, tool
   * exec time) there is only an "after" sample.
   */
  before?: number;
  /** Numeric "after" value, in the same units as `before`. */
  after?: number;
  /** Unit string ("tokens", "ms", "bytes", etc.) for display. */
  unit: string;
  /**
   * Pre-computed "delta" string for display (e.g. "-83%", "1.4x"). Computed
   * by the orchestrator if both before/after are present and absent.
   */
  delta?: string;
  status: BenchmarkStatus;
  /** Optional one-line note shown next to the row. */
  note?: string;
  /**
   * Free-form structured payload for the JSON output (machine-readable).
   * Avoid putting opinions here — facts only.
   */
  details?: Record<string, unknown>;
}

export interface BenchmarkRun {
  /** ISO-8601 string. */
  ts: string;
  /** Repo HEAD short sha at run time, if discoverable. */
  commit?: string;
  /** Node version that produced the run. */
  node: string;
  /** Whether live-gateway benchmarks were run. */
  live: boolean;
  results: BenchmarkResult[];
}

/** Estimator: ~4 chars per token is the rough Anthropic ballpark. */
export function estimateTokens(text: string): number {
  // Trivial estimator. Goal is relative measurement, not exact token math.
  // chars / 4 is the published Anthropic guidance for English prose.
  return Math.ceil(text.length / 4);
}
