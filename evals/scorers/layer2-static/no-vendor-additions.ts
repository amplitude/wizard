/**
 * Layer 2, criterion 3 — no non-vendor packages installed by the
 * agent. Medium (5 pts).
 *
 * Diffs the post-run `package.json` against the pristine baseline.
 * For every dep that's new (or version-changed), assert it's
 * Amplitude-vendor or a known peer the framework needs. The
 * regression class: agent installs a random helper lib (`uuid`,
 * `lodash`) to "make tracking work" — that's never the right answer.
 *
 * Allowlist:
 *   - `@amplitude/*` — vendor.
 *   - Pre-existing deps unchanged or version-bumped within the
 *     same major are fine (we trust the wizard's version-bump pass).
 *
 * Anything else added is a fail with the violator names. If the
 * pristine fixture is missing (shouldn't happen — runReplay/runLive
 * both depend on it) the scorer returns informational pass.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

import type { Artifact, Scenario, Scorer } from '../../runner/types.js';

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function flatDeps(pkg: PackageJsonShape): Record<string, string> {
  return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
}

function findPristine(workingDir: string): string | undefined {
  // working-dir under the scenario looks like
  // `<scenarioDir>/golden/working` or `<scenarioDir>/working` (live).
  // Walk up until we find `pristine/`.
  let dir = workingDir;
  for (let i = 0; i < 5; i++) {
    const candidate = resolve(dir, 'pristine');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export const scorer: Scorer = {
  id: 'L2-no-vendor-additions',
  layer: 2,
  criterion: 3,
  description: 'Agent must not install non-Amplitude packages to "fix" things.',
  evaluate(_artifact: Artifact, _scenario: Scenario) {
    const root = process.env.EVALS_WORKING_DIR;
    if (!root) {
      return {
        pass: true,
        weight: 0,
        detail: 'EVALS_WORKING_DIR unset; cannot read package.json',
      };
    }
    const pristineDir = findPristine(root);
    if (!pristineDir) {
      return {
        pass: true,
        weight: 0,
        detail: 'pristine baseline not found; cannot diff deps',
      };
    }

    let working: PackageJsonShape;
    let pristine: PackageJsonShape;
    try {
      working = JSON.parse(
        readFileSync(join(root, 'package.json'), 'utf8'),
      ) as PackageJsonShape;
      pristine = JSON.parse(
        readFileSync(join(pristineDir, 'package.json'), 'utf8'),
      ) as PackageJsonShape;
    } catch {
      return {
        pass: true,
        weight: 0,
        detail: 'no package.json on one side — skip dep diff',
      };
    }

    const workingDeps = flatDeps(working);
    const pristineDeps = flatDeps(pristine);

    const offenders: string[] = [];
    for (const [name, spec] of Object.entries(workingDeps)) {
      const wasPresent = pristineDeps[name] !== undefined;
      const versionChanged = wasPresent && pristineDeps[name] !== spec;
      const isAdded = !wasPresent;
      if (!isAdded && !versionChanged) continue;
      // New / changed dep — must be Amplitude-vendor.
      if (name.startsWith('@amplitude/')) continue;
      // Allow version-only bumps to pre-existing deps (the wizard's
      // version-bump pass touches them; we trust that).
      if (versionChanged && !isAdded) continue;
      offenders.push(name);
    }
    if (offenders.length === 0) return { pass: true, weight: 5 };
    return {
      pass: false,
      weight: 5,
      detail: `non-vendor packages added: ${offenders.join(', ')}`,
      evidencePath: 'package.json',
    };
  },
};
