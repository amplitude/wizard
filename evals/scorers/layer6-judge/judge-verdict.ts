/**
 * Layer 6 — LLM-judge verdict aggregation.
 *
 * Reads `Artifact.judgeResult` (populated by `runner/judge.ts`) and
 * grades the union of judge verdicts. Each verdict has its own weight
 * pulled from the rubric; a failed verdict subtracts its weight from
 * the aggregate score.
 *
 * Why a single scorer rather than one per criterion: the judge
 * produces one structured response per artifact. The aggregation
 * surface stays simple, the report's `detail` shows a per-criterion
 * pass/fail summary, and triage workflows don't have to chase six
 * separate skipped-because-no-judge entries when the runner skipped
 * the call.
 *
 * Skip semantics:
 *   - No judgeResult on artifact → skip-pass with weight 0.
 *   - judgeResult.ok=false → fail with the runner's detail (auth or
 *     transport failure; this is the runner's job to report cleanly).
 *   - judgeResult.ok=true → grade per-verdict, sum weights, return
 *     aggregate.
 */

import type { Artifact, Scorer } from '../../runner/types.js';

export const scorer: Scorer = {
  id: 'L6-judge-verdict',
  layer: 6,
  // Criterion 0 — the judge spans multiple criteria; the report's
  // detail names the specific ones that failed. Using 0 here keeps the
  // ScoredEntry shape unambiguous (a real criterion-N entry comes from
  // a deterministic scorer; the judge entry is recognizable by layer 6).
  criterion: 0,
  description:
    'LLM judge grades taste signals (criteria 7, 15, 19) and aggregate.',
  evaluate(artifact: Artifact) {
    const judge = artifact.judgeResult;
    if (!judge) {
      return {
        pass: true,
        weight: 0,
        detail: 'skipped: no judgeResult on artifact',
      };
    }
    if (!judge.ok || !judge.response) {
      return {
        pass: false,
        weight: 0,
        detail: judge.detail ?? 'judge call failed',
      };
    }
    const verdicts = judge.response.verdicts;
    if (verdicts.length === 0) {
      return {
        pass: true,
        weight: 0,
        detail:
          'judge returned zero verdicts (rubric may not apply to this scenario)',
      };
    }
    const failures = verdicts.filter((v) => !v.pass);
    const totalWeight = verdicts.reduce((acc, v) => acc + v.weight, 0);
    if (failures.length === 0) {
      return { pass: true, weight: totalWeight };
    }
    const summary = failures
      .slice(0, 3)
      .map(
        (v) =>
          `criterion ${v.criterion} (${v.evidence_path}:${v.evidence_line_start}): ${v.rationale}`,
      )
      .join(' | ');
    return {
      pass: false,
      weight: totalWeight,
      detail: `judge flagged ${failures.length} criterion verdict(s): ${summary}`,
    };
  },
};
