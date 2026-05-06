/**
 * Layer 0, criterion 1 — correct SDK package family for the framework.
 *
 * Hard fail: the project's `package.json` doesn't declare the expected
 * SDK package as a dependency (or declares the wrong family — e.g.
 * `@amplitude/analytics-browser` for a browser framework where the
 * project rule is `@amplitude/unified`).
 *
 * Reads `package.json` from the tree pinned via `EVALS_WORKING_DIR`.
 * For non-Node frameworks, scenario authors should use a different
 * scorer (mobile fixtures use `Podfile` / `build.gradle` checks); this
 * one is JS/TS only.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Artifact, Scenario, Scorer } from '../../runner/types.js';

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * For browser frameworks, the project rule (and `expectedSdkPackage`
 * in the scenario manifest) is `@amplitude/unified`. We treat
 * `@amplitude/analytics-browser` as a *known wrong family* for those
 * scenarios — explicit hard-fail with a tailored detail so the next
 * developer immediately sees the project rule.
 */
const KNOWN_WRONG_BROWSER_FAMILY = '@amplitude/analytics-browser';

export const scorer: Scorer = {
  id: 'L0-correct-sdk-package',
  layer: 0,
  criterion: 1,
  description:
    'package.json must declare the framework-correct SDK package family.',
  evaluate(_artifact: Artifact, scenario: Scenario) {
    const root = process.env.EVALS_WORKING_DIR;
    if (!root) {
      return {
        pass: true,
        weight: 0,
        detail: 'EVALS_WORKING_DIR unset; cannot read package.json',
      };
    }
    let pkg: PackageJsonShape;
    try {
      pkg = JSON.parse(
        readFileSync(join(root, 'package.json'), 'utf8'),
      ) as PackageJsonShape;
    } catch (err) {
      return {
        pass: false,
        hardFail: true,
        weight: 0,
        detail: `failed to read package.json: ${
          err instanceof Error ? err.message : 'unknown'
        }`,
        evidencePath: 'package.json',
      };
    }

    const deps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };

    if (deps[scenario.expectedSdkPackage]) {
      return { pass: true, weight: 0 };
    }

    if (
      scenario.expectedSdkPackage === '@amplitude/unified' &&
      deps[KNOWN_WRONG_BROWSER_FAMILY]
    ) {
      return {
        pass: false,
        hardFail: true,
        weight: 0,
        detail: `package.json declares ${KNOWN_WRONG_BROWSER_FAMILY} but the project rule is @amplitude/unified for browser frameworks`,
        evidencePath: 'package.json',
      };
    }

    return {
      pass: false,
      hardFail: true,
      weight: 0,
      detail: `package.json does not declare ${scenario.expectedSdkPackage}`,
      evidencePath: 'package.json',
    };
  },
};
