/**
 * Layer 4 — runtime probe scorer.
 *
 * Heavy (10 pts). Reads `Artifact.runtimeResult` populated by
 * `runner/runtime.ts`. The probe must:
 *   1. Have booted successfully (`ok === true`).
 *   2. Loaded the navigation route with a 2xx/3xx status code.
 *   3. Produced no uncaught console errors.
 *   4. Fired at least one outbound Amplitude request (the SDK actually
 *      ran — not a no-op import that compiled away).
 *
 * Absent `runtimeResult` → skip-pass with weight 0. The probe is opt-in
 * (scenarios opt in by declaring a `runtimeProbe` config and runners
 * opt in via `--runtime`) so absence is "no signal," not failure.
 *
 * Maps to failure modes #16 (uncaught exceptions in page console) and
 * partially #5/#11 (init in the wrong context — surfaces here as a
 * runtime exception rather than a static AST hit).
 */

import type { Artifact, Scorer } from '../../runner/types.js';

export const scorer: Scorer = {
  id: 'L4-runtime-probe',
  layer: 4,
  criterion: 17,
  description:
    'Runtime probe must boot, render, fire ≥1 Amplitude request, and produce no console errors.',
  evaluate(artifact: Artifact) {
    const result = artifact.runtimeResult;
    if (!result) {
      return {
        pass: true,
        weight: 0,
        detail: 'skipped: no runtimeResult on artifact',
      };
    }
    if (!result.ok) {
      return {
        pass: false,
        weight: 10,
        detail: result.detail ?? 'runtime probe reported ok=false',
      };
    }
    if (result.pageStatusCode < 200 || result.pageStatusCode >= 400) {
      return {
        pass: false,
        weight: 10,
        detail: `page navigation returned status ${result.pageStatusCode}`,
      };
    }
    if (result.consoleErrors.length > 0) {
      return {
        pass: false,
        weight: 10,
        detail: `${result.consoleErrors.length} console error(s): ${result.consoleErrors[0]}`,
      };
    }
    if (result.amplitudeRequestCount === 0) {
      return {
        pass: false,
        weight: 10,
        detail:
          'page rendered cleanly but Amplitude SDK fired zero outbound requests — init likely never executed',
      };
    }
    return { pass: true, weight: 10 };
  },
};
