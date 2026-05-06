/**
 * Layer 2, criterion 2 — SDK version range is sane.
 * Medium (5 pts).
 *
 * Reads the post-run `package.json` from the working tree and checks
 * the version specifier on every `@amplitude/*` dependency.
 *
 * Pass shapes:
 *   - Caret-pinned: `^1.2.3`
 *   - Tilde-pinned: `~1.2.3`
 *   - Exact:        `1.2.3`
 *   - Workspace / file / link / npm: protocols (workspace mono-repos)
 *
 * Fail shapes:
 *   - Wildcard major: `*`, `x`, `1.x`, `1.x.x`, `latest`
 *   - Pre-release tag without explicit allow: `1.2.3-alpha.0`,
 *     `1.2.3-beta`, `1.2.3-rc.1`, `0.0.0-canary-...`
 *
 * The pre-release filter is conservative — we don't want to ship
 * customers onto an unstable release by default. If a fixture
 * legitimately wants a pre-release SDK it can opt out by setting
 * `allowPrereleaseSdk: true` in its scenario (Week 2+; not yet
 * wired). Until then this scorer hard-defaults to fail on
 * pre-release tags.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Artifact, Scenario, Scorer } from '../../runner/types.js';

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const ALLOW_PROTOCOLS = ['workspace:', 'file:', 'link:', 'npm:'];
const WILDCARD_MAJOR = /^(?:\*|x|x\.x|x\.x\.x|\d+\.x|\d+\.x\.x|latest)$/i;
const PRERELEASE_TAG = /-(?:alpha|beta|rc|canary|next|preview)\b/i;

function isAcceptable(
  spec: string,
): { ok: true } | { ok: false; reason: string } {
  for (const proto of ALLOW_PROTOCOLS) {
    if (spec.startsWith(proto)) return { ok: true };
  }
  if (WILDCARD_MAJOR.test(spec.trim())) {
    return { ok: false, reason: 'wildcard / latest version' };
  }
  if (PRERELEASE_TAG.test(spec)) {
    return { ok: false, reason: 'pre-release tag' };
  }
  // Caret/tilde/exact — anything starting with ^, ~, =, digit, v.
  return { ok: true };
}

export const scorer: Scorer = {
  id: 'L2-version-range',
  layer: 2,
  criterion: 2,
  description:
    'Amplitude SDK version specifiers must be sane — no wildcards, no pre-releases unless opted in.',
  evaluate(_artifact: Artifact, _scenario: Scenario) {
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
    } catch {
      return {
        pass: true,
        weight: 0,
        detail: 'no package.json — scenario probably non-Node, skip',
      };
    }
    const all = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
    const violations: string[] = [];
    for (const [name, spec] of Object.entries(all)) {
      if (!name.startsWith('@amplitude/')) continue;
      const v = isAcceptable(spec);
      if (!v.ok) violations.push(`${name}@${spec} (${v.reason})`);
    }
    if (violations.length === 0) return { pass: true, weight: 5 };
    return {
      pass: false,
      weight: 5,
      detail: `unacceptable version specifiers: ${violations.join(', ')}`,
      evidencePath: 'package.json',
    };
  },
};
