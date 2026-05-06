/**
 * Layer 0, criterion 10 — no build-config bridging to inject env vars.
 *
 * Hard fail: the agent modified any of `next.config.js` /
 * `next.config.mjs` / `vite.config.ts` / `webpack.config.js` /
 * `babel.config.js` (or whatever a scenario lists in
 * `forbiddenPaths`). The supported pattern is the framework's own env
 * mechanism (`NEXT_PUBLIC_*`, `VITE_*`, `EXPO_PUBLIC_*`); modifying a
 * build config to ferry secrets is a regression class we've explicitly
 * called out in the spec.
 *
 * Implementation: pure diff inspection. No file content read needed —
 * if the path appears in `added` or `modified`, that's a hard fail.
 * (Deletion of a forbidden path isn't covered by this scorer; we
 * haven't seen a regression where the agent deletes the build config,
 * and adding a delete check would risk false-positives on legitimate
 * cleanup. Revisit if a deletion regression surfaces.)
 */

import type { Artifact, Scenario, Scorer } from '../../runner/types.js';

export const scorer: Scorer = {
  id: 'L0-no-build-config-bridging',
  layer: 0,
  criterion: 10,
  description:
    'Build-config files (next.config.*, vite.config.*, etc.) must not be modified to ferry env vars.',
  evaluate(artifact: Artifact, scenario: Scenario) {
    const touched = new Set<string>([
      ...artifact.fsSnapshot.diff.added,
      ...artifact.fsSnapshot.diff.modified,
    ]);
    const violators = scenario.forbiddenPaths.filter((p) => touched.has(p));
    if (violators.length === 0) return { pass: true, weight: 0 };
    return {
      pass: false,
      hardFail: true,
      weight: 0,
      detail: `forbidden paths were modified: ${violators.join(', ')}`,
      evidencePath: violators[0],
    };
  },
};
