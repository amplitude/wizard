/**
 * Layer 2, criterion 7 — init options object carries comments.
 * Medium (5 pts).
 *
 * DX guarantee: the next dev who reads `init(apiKey, { ... })` should
 * be able to see what the togglable knobs do without leaving the
 * file. The wizard's commandments require comments around init
 * options; this scorer enforces it.
 *
 * Heuristic: in the entry file, find a call to `init(...)` whose
 * second argument is an object literal. For each property in that
 * object, look for a leading comment trivia or an inline comment on
 * the same line. Pass if either:
 *   - The options object is empty / absent (nothing to comment).
 *   - At least one property has a comment.
 *
 * The "at least one" floor is intentional. Some scenarios surface
 * defaults that don't need per-flag commentary; what we're catching
 * is the regression where the agent emits a multi-flag block with
 * zero rationale.
 */

import { join } from 'node:path';
import * as ts from 'typescript';

import { findCallsByName, parseFile } from './_ast-helpers.js';
import type { Artifact, Scenario, Scorer } from '../../runner/types.js';

function hasLeadingComment(node: ts.Node, source: ts.SourceFile): boolean {
  const text = source.getFullText();
  const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
  return ranges.length > 0;
}

function hasTrailingComment(node: ts.Node, source: ts.SourceFile): boolean {
  const text = source.getFullText();
  const ranges = ts.getTrailingCommentRanges(text, node.getEnd()) ?? [];
  return ranges.length > 0;
}

export const scorer: Scorer = {
  id: 'L2-init-options-commented',
  layer: 2,
  criterion: 7,
  description:
    'init() options object should carry at least one comment explaining a toggle.',
  evaluate(artifact: Artifact, scenario: Scenario) {
    const root = process.env.EVALS_WORKING_DIR;
    if (!root) {
      return {
        pass: true,
        weight: 0,
        detail: 'EVALS_WORKING_DIR unset; cannot scan tree',
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
        weight: 5,
        detail: `expected init file ${target} not found in diff`,
        evidencePath: target,
      };
    }
    const sf = parseFile(join(root, matchPath));
    if (!sf) {
      return {
        pass: false,
        weight: 5,
        detail: `failed to parse ${matchPath}`,
        evidencePath: matchPath,
      };
    }
    const calls = findCallsByName(sf, 'init');
    if (calls.length === 0) {
      // Layer 1 already grades init() presence; here we're not the
      // gate for that. Pass through.
      return {
        pass: true,
        weight: 5,
        detail: 'no init() call found in entry file',
      };
    }
    for (const call of calls) {
      const opts = call.arguments[1];
      if (!opts || !ts.isObjectLiteralExpression(opts)) continue;
      if (opts.properties.length === 0) {
        // Empty options object — nothing to comment, treat as pass.
        return { pass: true, weight: 5 };
      }
      for (const prop of opts.properties) {
        if (hasLeadingComment(prop, sf) || hasTrailingComment(prop, sf)) {
          return { pass: true, weight: 5 };
        }
      }
      return {
        pass: false,
        weight: 5,
        detail: `init() options block in ${matchPath} has no commented properties`,
        evidencePath: matchPath,
      };
    }
    return { pass: true, weight: 5 };
  },
};
