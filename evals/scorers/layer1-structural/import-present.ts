/**
 * Layer 1, criterion 4 (import side) — the expected init file imports
 * from the expected SDK package.
 *
 * Pairs with `file-touched.ts`: that scorer says "the right file got
 * written," this one says "and it imports from the right SDK." Cheap
 * regex over the file's `import` statements; AST inspection is Layer 2.
 *
 * Heavy (10 pts) because importing the wrong SDK package family in
 * the entry file is a regression every scenario should catch.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Artifact, Scenario, Scorer } from '../../runner/types.js';

const IMPORT_RE = /import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

export const scorer: Scorer = {
  id: 'L1-import-present',
  layer: 1,
  criterion: 4,
  description:
    'The expected init file must import from the expected SDK package.',
  evaluate(artifact: Artifact, scenario: Scenario) {
    const root = process.env.EVALS_WORKING_DIR;
    if (!root) {
      return {
        pass: true,
        weight: 0,
        detail: 'EVALS_WORKING_DIR unset; cannot read init file',
      };
    }

    const target = scenario.expectedInitFile;
    const touched = [
      ...artifact.fsSnapshot.diff.added,
      ...artifact.fsSnapshot.diff.modified,
    ];
    const matchPath =
      touched.find((p) => p === target) ??
      touched.find((p) => p.endsWith(`/${target}`));
    if (!matchPath) {
      return {
        pass: false,
        weight: 10,
        detail: `expected init file ${target} not found in diff (run file-touched first)`,
        evidencePath: target,
      };
    }

    let text: string;
    try {
      text = readFileSync(join(root, matchPath), 'utf8');
    } catch (err) {
      return {
        pass: false,
        weight: 10,
        detail: `failed to read ${matchPath}: ${
          err instanceof Error ? err.message : 'unknown'
        }`,
        evidencePath: matchPath,
      };
    }

    const imports = new Set<string>();
    for (const m of text.matchAll(IMPORT_RE)) imports.add(m[1]);
    for (const m of text.matchAll(REQUIRE_RE)) imports.add(m[1]);
    if (imports.has(scenario.expectedSdkPackage)) {
      return { pass: true, weight: 10 };
    }
    // Permit subpaths (e.g. `@amplitude/unified/server`) — some SDKs
    // expose multiple entrypoints. Match by package-name prefix.
    for (const i of imports) {
      if (
        i === scenario.expectedSdkPackage ||
        i.startsWith(`${scenario.expectedSdkPackage}/`)
      ) {
        return { pass: true, weight: 10 };
      }
    }
    return {
      pass: false,
      weight: 10,
      detail: `${matchPath} does not import from ${scenario.expectedSdkPackage}`,
      evidencePath: matchPath,
    };
  },
};
