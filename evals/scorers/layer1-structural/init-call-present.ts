/**
 * Layer 1, criterion 5 + 14 floor — at least one Amplitude init() call
 * exists in the working tree.
 *
 * Medium (5 pts). Pairs with the Layer 0 `single-init-call` hard-fail
 * gate: this scorer awards points for the positive case (at least one
 * init landed); Layer 0 hard-fails when there are zero or many. They
 * intentionally overlap — Layer 0 short-circuits scoring on a hard
 * fail, Layer 1 records the positive verdict for the report.
 *
 * Cheap regex; AST verification is Layer 2.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Artifact, Scenario, Scorer } from '../../runner/types.js';

const SCAN_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const NAMED_INIT_IMPORT =
  /\bimport\s*\{[^}]*\binit\b[^}]*\}\s*from\s*['"]@amplitude\/(unified|analytics-[a-z-]+)['"]/;
const QUALIFIED_INIT_CALL = /\bamplitude\.init\s*\(/;
const BARE_INIT_CALL = /\binit\s*\(/;

export const scorer: Scorer = {
  id: 'L1-init-call-present',
  layer: 1,
  criterion: 5,
  description: 'At least one Amplitude init() callsite must exist in the diff.',
  evaluate(artifact: Artifact, _scenario: Scenario) {
    const root = process.env.EVALS_WORKING_DIR;
    if (!root) {
      return {
        pass: true,
        weight: 0,
        detail: 'EVALS_WORKING_DIR unset; cannot scan tree for init()',
      };
    }
    const candidates = [
      ...artifact.fsSnapshot.diff.added,
      ...artifact.fsSnapshot.diff.modified,
    ].filter((p) => SCAN_EXTS.some((ext) => p.endsWith(ext)));

    for (const path of candidates) {
      let text: string;
      try {
        text = readFileSync(join(root, path), 'utf8');
      } catch {
        continue;
      }
      if (QUALIFIED_INIT_CALL.test(text)) {
        return { pass: true, weight: 5, evidencePath: path };
      }
      if (NAMED_INIT_IMPORT.test(text) && BARE_INIT_CALL.test(text)) {
        return { pass: true, weight: 5, evidencePath: path };
      }
    }
    return {
      pass: false,
      weight: 5,
      detail: 'no Amplitude init() callsite found in any added/modified file',
    };
  },
};
