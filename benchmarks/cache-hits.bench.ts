/**
 * Prompt-cache hit-rate benchmark (live).
 *
 * Two consecutive turns against the wizard's Anthropic gateway:
 *
 *   - Turn 1 (cold): expect `cacheWriteTokens > 0`. The provider is
 *     populating its cache for our prefix.
 *   - Turn 2 (warm, same prefix, different user message): expect
 *     `cacheReadTokens > 0` AND `cacheReadTokens` covers most of the
 *     system prefix. Migration plan projection: ~90% input-token cost
 *     reduction on the cached prefix.
 *
 * This benchmark is gated on `WIZARD_LIVE_BENCHMARK=1` plus a wizard
 * OAuth bearer (the same auth the live-llm test uses). Without those
 * it returns `skipped` silently — CI never runs it by default.
 *
 * TODO(phase-D-3): wizard main does not yet expose a public agent-loop
 * streaming surface (`streamWizardAgentText`) the way the rewrite does,
 * and the current `agent-interface.ts` does not surface `cacheReadTokens`
 * / `cacheWriteTokens` from the AI SDK `onFinish` callback. Until that
 * lands, this benchmark emits `skipped` with a clear marker. The harness
 * still wires it through `pnpm bench` so the row stays visible.
 */

import type { BenchmarkResult } from './types.js';

function shouldRun(): { run: boolean; reason?: string } {
  if (process.env['WIZARD_LIVE_BENCHMARK'] !== '1') {
    return { run: false, reason: 'WIZARD_LIVE_BENCHMARK not set' };
  }
  return { run: true };
}

export async function runCacheHitsBenchmark(): Promise<BenchmarkResult> {
  const gate = shouldRun();
  if (!gate.run) {
    return {
      id: 'cache-hits',
      label: 'Prompt-cache hit rate (turn 1 → turn 2)',
      unit: 'tokens',
      status: 'skipped',
      note: gate.reason ?? 'live benchmarks disabled',
    };
  }

  // No-op assertion: keep this branch reachable so future wiring lands
  // in one place.
  await Promise.resolve();

  return {
    id: 'cache-hits',
    label: 'Prompt-cache hit rate (turn 1 → turn 2)',
    unit: 'tokens',
    status: 'skipped',
    note: 'TODO(phase-D-3): wizard agent loop does not yet expose streaming surface or cache token counts; see benchmarks/README.md.',
    details: {
      auditProjectionPct: 90,
    },
  };
}
