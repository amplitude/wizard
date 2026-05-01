import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/constants', () => ({
  IS_DEV: false,
  // Must be present (not just defaulted to undefined): commandments.ts
  // reads `DEMO_MODE` at module load via a real ESM import, and Vitest's
  // strict mocker throws "No DEMO_MODE export is defined on the mock" if
  // the key is missing entirely. Belt-and-braces: nothing in this file's
  // current import graph loads commandments, but a partial mock of
  // ../../lib/constants is a pit-trap for future imports.
  DEMO_MODE: false,
}));

vi.mock('../setup-utils', () => ({
  tryGetPackageJson: vi.fn(),
}));

import {
  isNonInteractiveEnvironment,
  detectEnvVarPrefix,
} from '../environment.js';
import { tryGetPackageJson } from '../setup-utils.js';

// ── isNonInteractiveEnvironment ───────────────────────────────────────────────

describe('isNonInteractiveEnvironment', () => {
  const origStdoutTTY = process.stdout.isTTY;
  const origStderrTTY = process.stderr.isTTY;

  beforeEach(() => {
    // Restore defaults
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
    });
    Object.defineProperty(process.stderr, 'isTTY', {
      value: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: origStdoutTTY,
      configurable: true,
    });
    Object.defineProperty(process.stderr, 'isTTY', {
      value: origStderrTTY,
      configurable: true,
    });
  });

  it('returns false when both stdout and stderr are TTY', () => {
    expect(isNonInteractiveEnvironment()).toBe(false);
  });

  it('returns true when stdout is not a TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      configurable: true,
    });
    expect(isNonInteractiveEnvironment()).toBe(true);
  });

  it('returns true when stderr is not a TTY', () => {
    Object.defineProperty(process.stderr, 'isTTY', {
      value: false,
      configurable: true,
    });
    expect(isNonInteractiveEnvironment()).toBe(true);
  });
});

// ── detectEnvVarPrefix ────────────────────────────────────────────────────────

describe('detectEnvVarPrefix', () => {
  const opts = { installDir: '/tmp/test', debug: false } as never;

  beforeEach(() => {
    vi.mocked(tryGetPackageJson).mockReset();
  });

  it('returns "VITE_PUBLIC_" when no package.json is found', async () => {
    vi.mocked(tryGetPackageJson).mockResolvedValue(undefined);
    expect(await detectEnvVarPrefix(opts)).toBe('VITE_PUBLIC_');
  });

  it('returns "NEXT_PUBLIC_" for a project with next dependency', async () => {
    vi.mocked(tryGetPackageJson).mockResolvedValue({
      dependencies: { next: '14.0.0' },
      devDependencies: {},
    } as never);
    expect(await detectEnvVarPrefix(opts)).toBe('NEXT_PUBLIC_');
  });

  it('returns "REACT_APP_" for a project with react-scripts', async () => {
    vi.mocked(tryGetPackageJson).mockResolvedValue({
      dependencies: { 'react-scripts': '5.0.0' },
      devDependencies: {},
    } as never);
    expect(await detectEnvVarPrefix(opts)).toBe('REACT_APP_');
  });

  it('returns "REACT_APP_" for a project with create-react-app', async () => {
    vi.mocked(tryGetPackageJson).mockResolvedValue({
      dependencies: { 'create-react-app': '5.0.0' },
      devDependencies: {},
    } as never);
    expect(await detectEnvVarPrefix(opts)).toBe('REACT_APP_');
  });

  it('returns "VITE_PUBLIC_" for a project with vite', async () => {
    vi.mocked(tryGetPackageJson).mockResolvedValue({
      dependencies: {},
      devDependencies: { vite: '5.0.0' },
    } as never);
    expect(await detectEnvVarPrefix(opts)).toBe('VITE_PUBLIC_');
  });

  it('returns "PUBLIC_" for a project with @sveltejs/kit', async () => {
    vi.mocked(tryGetPackageJson).mockResolvedValue({
      dependencies: { '@sveltejs/kit': '2.0.0' },
      devDependencies: {},
    } as never);
    expect(await detectEnvVarPrefix(opts)).toBe('PUBLIC_');
  });

  it('returns "VITE_PUBLIC_" for a project with @tanstack/start', async () => {
    vi.mocked(tryGetPackageJson).mockResolvedValue({
      dependencies: { '@tanstack/start': '1.0.0' },
      devDependencies: {},
    } as never);
    expect(await detectEnvVarPrefix(opts)).toBe('VITE_PUBLIC_');
  });

  it('returns "VITE_PUBLIC_" for a project with solid-start', async () => {
    vi.mocked(tryGetPackageJson).mockResolvedValue({
      dependencies: { 'solid-start': '1.0.0' },
      devDependencies: {},
    } as never);
    expect(await detectEnvVarPrefix(opts)).toBe('VITE_PUBLIC_');
  });

  it('returns "PUBLIC_" for a project with astro', async () => {
    vi.mocked(tryGetPackageJson).mockResolvedValue({
      dependencies: { astro: '4.0.0' },
      devDependencies: {},
    } as never);
    expect(await detectEnvVarPrefix(opts)).toBe('PUBLIC_');
  });

  it('returns "VITE_PUBLIC_" as default for unknown dependencies', async () => {
    vi.mocked(tryGetPackageJson).mockResolvedValue({
      dependencies: { express: '4.0.0' },
      devDependencies: {},
    } as never);
    expect(await detectEnvVarPrefix(opts)).toBe('VITE_PUBLIC_');
  });
});
