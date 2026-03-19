import { describe, it, expect } from 'vitest';
import {
  findInstalledPackageFromList,
  hasPackageInstalled,
  getPackageVersion,
} from '../package-json.js';
import type { PackageDotJson } from '../package-json.js';

// ── getPackageVersion ─────────────────────────────────────────────────────────

describe('getPackageVersion', () => {
  it('returns the version from dependencies', () => {
    const pkg: PackageDotJson = { dependencies: { react: '^18.0.0' } };
    expect(getPackageVersion('react', pkg)).toBe('^18.0.0');
  });

  it('returns the version from devDependencies', () => {
    const pkg: PackageDotJson = { devDependencies: { vitest: '^1.0.0' } };
    expect(getPackageVersion('vitest', pkg)).toBe('^1.0.0');
  });

  it('prefers dependencies over devDependencies', () => {
    const pkg: PackageDotJson = {
      dependencies: { react: '^18.0.0' },
      devDependencies: { react: '^17.0.0' },
    };
    expect(getPackageVersion('react', pkg)).toBe('^18.0.0');
  });

  it('returns undefined when package is not found', () => {
    const pkg: PackageDotJson = { dependencies: { react: '^18.0.0' } };
    expect(getPackageVersion('vue', pkg)).toBeUndefined();
  });

  it('returns undefined for empty package.json', () => {
    expect(getPackageVersion('react', {})).toBeUndefined();
  });
});

// ── hasPackageInstalled ───────────────────────────────────────────────────────

describe('hasPackageInstalled', () => {
  it('returns true when package is in dependencies', () => {
    const pkg: PackageDotJson = { dependencies: { react: '^18.0.0' } };
    expect(hasPackageInstalled('react', pkg)).toBe(true);
  });

  it('returns true when package is in devDependencies', () => {
    const pkg: PackageDotJson = { devDependencies: { typescript: '^5.0.0' } };
    expect(hasPackageInstalled('typescript', pkg)).toBe(true);
  });

  it('returns false when package is absent', () => {
    const pkg: PackageDotJson = { dependencies: { react: '^18.0.0' } };
    expect(hasPackageInstalled('vue', pkg)).toBe(false);
  });
});

// ── findInstalledPackageFromList ──────────────────────────────────────────────

describe('findInstalledPackageFromList', () => {
  it('returns the first matching package with its version', () => {
    const pkg: PackageDotJson = {
      dependencies: { react: '^18.0.0', vue: '^3.0.0' },
    };
    const result = findInstalledPackageFromList(['vue', 'react'], pkg);
    expect(result).toEqual({ name: 'vue', version: '^3.0.0' });
  });

  it('returns undefined when no package from the list is installed', () => {
    const pkg: PackageDotJson = { dependencies: { react: '^18.0.0' } };
    const result = findInstalledPackageFromList(['angular', 'svelte'], pkg);
    expect(result).toBeUndefined();
  });

  it('returns undefined for an empty list', () => {
    const pkg: PackageDotJson = { dependencies: { react: '^18.0.0' } };
    expect(findInstalledPackageFromList([], pkg)).toBeUndefined();
  });

  it('finds a package in devDependencies', () => {
    const pkg: PackageDotJson = { devDependencies: { vitest: '^1.0.0' } };
    const result = findInstalledPackageFromList(['jest', 'vitest'], pkg);
    expect(result).toEqual({ name: 'vitest', version: '^1.0.0' });
  });
});
