import { describe, expect, it } from 'vitest';
import type { PackageDotJson } from '../../../utils/package-json';
import { javascriptWebBlockedByFrameworkPackage } from '../javascript-web-blocking-policy';

describe('javascriptWebBlockedByFrameworkPackage', () => {
  it('blocks when next is present', () => {
    const pkg: PackageDotJson = {
      dependencies: { next: '^15.0.0' },
    };
    expect(javascriptWebBlockedByFrameworkPackage(pkg)).toBe(true);
  });

  it('does not block VitePress + vue', () => {
    const pkg: PackageDotJson = {
      devDependencies: {
        vue: '^3.5.0',
        vitepress: '^1.6.0',
      },
    };
    expect(javascriptWebBlockedByFrameworkPackage(pkg)).toBe(false);
  });

  it('still blocks plain vue SPA', () => {
    const pkg: PackageDotJson = {
      dependencies: { vue: '^3.5.0' },
    };
    expect(javascriptWebBlockedByFrameworkPackage(pkg)).toBe(true);
  });
});
