/**
 * Layer 0, criterion 8 — API key is read from an env var, never
 * hardcoded.
 *
 * Hard fail: any literal API-key match (or ≥16-char prefix substring)
 * in any added/modified file short-circuits the scorer stack.
 *
 * The API key isn't on the artifact (we deliberately don't write it
 * there — that would make scoring history a vector for leaking the
 * key). We probe for the test key via env vars and known fixture
 * locations. If the runner can't tell us what the key is, this
 * scorer is informational only — return a soft pass with a detail
 * noting the gap.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Artifact, Scenario, Scorer } from '../../runner/types.js';

const MIN_FRAGMENT_LEN = 16;

/**
 * Resolve the API key the runner would have passed to the wizard.
 * Order:
 *   1. AMPLITUDE_WIZARD_API_KEY env var (matches the wizard's own
 *      flag alias).
 *   2. AMPLITUDE_EVAL_API_KEY (eval-only project; not yet provisioned
 *      as of Week 1 but reserved for when it lands).
 *   3. None — Layer 0 then has nothing to grep against and returns
 *      a soft pass marked unverified.
 */
function resolveApiKey(): string | undefined {
  return (
    process.env.AMPLITUDE_EVAL_API_KEY ??
    process.env.AMPLITUDE_WIZARD_API_KEY ??
    undefined
  );
}

export const scorer: Scorer = {
  id: 'L0-no-hardcoded-key',
  layer: 0,
  criterion: 8,
  description:
    'API key must never appear as a literal in any added or modified file.',
  evaluate(artifact: Artifact, _scenario: Scenario) {
    const apiKey = resolveApiKey();
    if (!apiKey) {
      return {
        pass: true,
        weight: 0,
        detail:
          'no API key configured (AMPLITUDE_EVAL_API_KEY unset); skip — see evals/README.md known gaps',
      };
    }
    const fragment = apiKey.slice(0, MIN_FRAGMENT_LEN);
    const candidates = [
      ...artifact.fsSnapshot.diff.added,
      ...artifact.fsSnapshot.diff.modified,
    ];
    // Read from the working/golden tree under the scenario dir. The
    // runner sets process.env.EVALS_WORKING_DIR before invoking
    // scorers so we know where to read from for live runs.
    const root = process.env.EVALS_WORKING_DIR;
    if (!root) {
      // Without a working dir we can't read content; be conservative
      // and return informational pass rather than false-positive.
      return {
        pass: true,
        weight: 0,
        detail:
          'EVALS_WORKING_DIR unset; runner did not pin a tree to grep against',
      };
    }
    for (const path of candidates) {
      let text: string;
      try {
        text = readFileSync(join(root, path), 'utf8');
      } catch {
        continue;
      }
      if (text.includes(apiKey) || text.includes(fragment)) {
        return {
          pass: false,
          hardFail: true,
          weight: 0,
          detail: `${path} contains the API key literal`,
          evidencePath: path,
        };
      }
    }
    return { pass: true, weight: 0 };
  },
};
