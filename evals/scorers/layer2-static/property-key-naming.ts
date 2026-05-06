/**
 * Layer 2, criterion 15 — property keys follow lowercase-with-spaces.
 * Soft warn (0 pts).
 *
 * The project rule (CLAUDE.md → Analytics conventions) says event
 * properties, user properties, and group-identify keys should be
 * lowercase-with-spaces: `'org id'`, `'project id'`, `'duration ms'`.
 *
 * Soft warn rather than scored because:
 *   - Customer projects vary; not every customer adopts the rule.
 *   - `$`-prefixed Amplitude-reserved keys pass through.
 *   - Single-word keys (`integration`, `region`) are fine as-is.
 *
 * The scorer collects every `track('Event', { key: ... })` call
 * across the diff, examines each property key, and emits a warn
 * detail with the offending pairs. Always returns `pass: true` with
 * weight 0 so it never gates merge — the signal is in the detail.
 */

import { join } from 'node:path';
import * as ts from 'typescript';

import { findCallsByName, isScannable, parseFile } from './_ast-helpers.js';
import type { Artifact, Scenario, Scorer } from '../../runner/types.js';

// Single-word lowercase or lowercase-with-spaces, no underscores or
// camelCase. Allows hyphens because some legacy keys use them.
const ALLOWED_KEY = /^[a-z][a-z0-9 ]*[a-z0-9]$|^[a-z]$/;
const ALLOWED_PREFIXES = ['$']; // Amplitude reserved (e.g. $app_name)

function isOk(key: string): boolean {
  if (key.length === 0) return true;
  if (ALLOWED_PREFIXES.some((p) => key.startsWith(p))) return true;
  return ALLOWED_KEY.test(key);
}

export const scorer: Scorer = {
  id: 'L2-property-key-naming',
  layer: 2,
  criterion: 15,
  description:
    'Property keys should be lowercase-with-spaces. Soft warn — never gates merge.',
  evaluate(artifact: Artifact, _scenario: Scenario) {
    const root = process.env.EVALS_WORKING_DIR;
    if (!root) {
      return {
        pass: true,
        weight: 0,
        detail: 'EVALS_WORKING_DIR unset; cannot scan',
      };
    }
    const candidates = [
      ...artifact.fsSnapshot.diff.added,
      ...artifact.fsSnapshot.diff.modified,
    ].filter((p) => isScannable(p));

    const violations: Array<{ file: string; key: string }> = [];
    for (const path of candidates) {
      const sf = parseFile(join(root, path));
      if (!sf) continue;
      const calls = findCallsByName(sf, 'track');
      for (const call of calls) {
        const props = call.arguments[1];
        if (!props || !ts.isObjectLiteralExpression(props)) continue;
        for (const prop of props.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          let key: string | undefined;
          if (
            ts.isStringLiteral(prop.name) ||
            ts.isNoSubstitutionTemplateLiteral(prop.name)
          ) {
            key = prop.name.text;
          } else if (ts.isIdentifier(prop.name)) {
            key = prop.name.text;
          }
          if (!key) continue;
          if (!isOk(key)) violations.push({ file: path, key });
        }
      }
    }

    if (violations.length === 0) return { pass: true, weight: 0 };
    const summary = violations
      .slice(0, 5)
      .map((v) => `${v.file}: '${v.key}'`)
      .join(', ');
    return {
      pass: true,
      weight: 0,
      detail: `[warn] property keys not in lowercase-with-spaces (${violations.length} total): ${summary}`,
    };
  },
};
