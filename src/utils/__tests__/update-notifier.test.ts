import { describe, it, expect } from 'vitest';
import { buildRegistryUrl } from '../update-notifier.js';

describe('buildRegistryUrl', () => {
  // Regression test for the Bugbot fix on PR #230. The previous
  // implementation used `encodeURIComponent(pkgName)` which produced
  // `%40amplitude%2Fwizard` — an over-encoded path that the npm
  // registry 404s. Scoped packages must keep the literal `@` and only
  // escape the `/`.
  it('keeps the literal @ and escapes only / for scoped packages', () => {
    expect(buildRegistryUrl('@amplitude/wizard')).toBe(
      'https://registry.npmjs.org/@amplitude%2fwizard',
    );
  });

  it('returns the unchanged name for unscoped packages', () => {
    expect(buildRegistryUrl('lodash')).toBe(
      'https://registry.npmjs.org/lodash',
    );
  });

  it('never encodes the @ sentinel', () => {
    const url = buildRegistryUrl('@amplitude/wizard');
    expect(url).not.toContain('%40');
  });
});
