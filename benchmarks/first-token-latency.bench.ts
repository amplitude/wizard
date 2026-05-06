/**
 * First-token latency benchmark (live).
 *
 * Records `Date.now()` at the moment we kick off agent streaming and
 * again at the first text-delta the consumer sees. Reports the delta for
 * both a cold turn (turn 1) and a warm turn (turn 2). The migration
 * plan's claim is that prompt caching provides "free latency reduction"
 * on the warm path — this benchmark puts a number on it.
 *
 * Gated on `WIZARD_LIVE_BENCHMARK=1`. Skipped otherwise.
 *
 * TODO(phase-D-3): wizard main does not yet expose a public
 * `streamWizardAgentText`-style streaming entry point. Until that lands,
 * this benchmark emits `skipped` with a clear marker. The harness still
 * wires it through `pnpm bench` so the row stays visible.
 */

import type { BenchmarkResult } from './types.js';

interface RunOpts {
  /** CLI `--live` flag from the harness. */
  live?: boolean;
}

function shouldRun(opts: RunOpts = {}): { run: boolean; reason?: string } {
  if (!opts.live && process.env['WIZARD_LIVE_BENCHMARK'] !== '1') {
    return {
      run: false,
      reason: 'pass --live or set WIZARD_LIVE_BENCHMARK=1',
    };
  }
  return { run: true };
}

export async function runFirstTokenLatencyBenchmark(
  opts: RunOpts = {},
): Promise<BenchmarkResult> {
  const gate = shouldRun(opts);
  if (!gate.run) {
    return {
      id: 'first-token-latency',
      label: 'First-token latency (cold vs warm)',
      unit: 'ms',
      status: 'skipped',
      note: gate.reason ?? 'live benchmarks disabled',
    };
  }

  // No-op assertion: keep this branch reachable so future wiring lands
  // in one place.
  await Promise.resolve();

  return {
    id: 'first-token-latency',
    label: 'First-token latency (cold vs warm)',
    unit: 'ms',
    status: 'skipped',
    note: 'TODO(phase-D-3): wizard agent loop does not yet expose a public streaming surface; see benchmarks/README.md.',
  };
}
