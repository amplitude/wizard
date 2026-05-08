/**
 * Layer 0, criterion 6 — exactly one `init()` call per project.
 *
 * Hard fail: more than one Amplitude `init()` callsite in the working
 * tree. Multiple inits cause double-counted events and duplicate
 * device IDs in the wild. Zero inits is also a fail (sanity floor).
 *
 * Implementation: cheap regex over `.ts`/`.tsx`/`.js`/`.jsx` files in
 * the diff. Counts `amplitude.init(`, `Amplitude.init(`, and named
 * imports of `init` from `@amplitude/unified` / `@amplitude/analytics-*`
 * SDKs. AST inspection lives in Layer 2 — this is the cheap, deterministic
 * gate.
 *
 * Caveat: the regex matches commented-out callsites. Better to false-
 * positive a comment than to miss a real second init; if a scenario
 * starts flagging on this, we'll AST-ify the check and demote it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Artifact, Scenario, Scorer } from '../../runner/types.js';

const SCAN_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

const INIT_PATTERNS = [
  // amplitude.init(...) / Amplitude.init(...) — generic global use
  /\bamplitude\.init\s*\(/gi,
  // import { init } from '@amplitude/unified' (or analytics-*) followed
  // by `init(` somewhere in the file — two-pass check.
];

const NAMED_IMPORT_PATTERN =
  /\bimport\s*\{[^}]*\binit\b[^}]*\}\s*from\s*['"]@amplitude\/(unified|analytics-[a-z-]+)['"]/;
const BARE_INIT_CALL = /\binit\s*\(/g;
const AMPLITUDE_DOT_INIT = /\bamplitude\.init\s*\(/gi;

function countInitCallsInFile(text: string): number {
  let count = 0;
  for (const pattern of INIT_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) count += matches.length;
  }
  if (NAMED_IMPORT_PATTERN.test(text)) {
    // BARE_INIT_CALL also matches the `init(` portion of any
    // `amplitude.init(` we already counted via INIT_PATTERNS — the `.`
    // is a non-word char, so `\binit(` matches both forms. Subtract
    // the overlap so a file with a single `amplitude.init(` and a
    // named-init import isn't double-counted.
    const bareMatches = text.match(BARE_INIT_CALL)?.length ?? 0;
    const amplitudeDotMatches = text.match(AMPLITUDE_DOT_INIT)?.length ?? 0;
    count += bareMatches - amplitudeDotMatches;
  }
  return count;
}

export const scorer: Scorer = {
  id: 'L0-single-init-call',
  layer: 0,
  criterion: 6,
  description:
    'Exactly one Amplitude init() callsite must exist in the project.',
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

    let total = 0;
    const hits: string[] = [];
    for (const path of candidates) {
      let text: string;
      try {
        text = readFileSync(join(root, path), 'utf8');
      } catch {
        continue;
      }
      const n = countInitCallsInFile(text);
      if (n > 0) {
        total += n;
        hits.push(`${path}(${n})`);
      }
    }

    if (total === 1) return { pass: true, weight: 0 };
    if (total === 0) {
      return {
        pass: false,
        hardFail: true,
        weight: 0,
        detail: 'no Amplitude init() callsite found in added/modified files',
      };
    }
    return {
      pass: false,
      hardFail: true,
      weight: 0,
      detail: `expected 1 init() callsite, found ${total} (${hits.join(', ')})`,
      evidencePath: hits[0]?.split('(')[0],
    };
  },
};
