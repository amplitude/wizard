/**
 * Layer 1, criterion 4 — init lives in the correct entry file for the
 * framework.
 *
 * Heavy (10 pts). Asserts that `scenario.expectedInitFile` appears in
 * the diff (added or modified). This is the cheap "did the agent touch
 * the right file at all" gate; the deeper "does that file contain a
 * valid init shape" check lives in `init-call-present.ts` and Layer 2.
 *
 * We accept either an exact path match or a path-suffix match — some
 * fixtures use `src/app/...` while others use `app/...`, and the
 * scenario manifest can use either.
 */

import type { Artifact, Scenario, Scorer } from '../../runner/types.js';

export const scorer: Scorer = {
  id: 'L1-file-touched',
  layer: 1,
  criterion: 4,
  description:
    'The expected init file (per scenario) must be created or modified by the agent.',
  evaluate(artifact: Artifact, scenario: Scenario) {
    const target = scenario.expectedInitFile;
    const touched = [
      ...artifact.fsSnapshot.diff.added,
      ...artifact.fsSnapshot.diff.modified,
    ];
    const hit =
      touched.includes(target) || touched.some((p) => p.endsWith(`/${target}`));
    if (hit) return { pass: true, weight: 10 };
    return {
      pass: false,
      weight: 10,
      detail: `expected init file ${target} was not created or modified`,
      evidencePath: target,
    };
  },
};
