import { describe, expect, it, beforeEach, afterEach } from 'vitest';

// Skip the per-project storage bootstrap (migration shim + log routing) —
// same rationale as build-session-from-options.test.ts.
process.env.AMPLITUDE_WIZARD_SKIP_BOOTSTRAP = '1';

import {
  getInstallDirFromArgv,
  resolveJsonOutput,
  extractErrorMessage,
} from '../helpers.js';

// These helpers replace ~20 sites of identical boilerplate across the
// command handlers. Cover the behavioural contract every caller depends
// on so any future drift fails fast here instead of mid-CI on a real
// CLI invocation.

describe('getInstallDirFromArgv', () => {
  it('reads --install-dir (kebab) when provided', () => {
    const dir = getInstallDirFromArgv({ 'install-dir': '/tmp/explicit' });
    expect(dir).toBe('/tmp/explicit');
  });

  it('reads installDir (camel) when provided — logout-style argv', () => {
    const dir = getInstallDirFromArgv({ installDir: '/tmp/camel' });
    expect(dir).toBe('/tmp/camel');
  });

  it('prefers --install-dir (kebab) over installDir (camel) when both set', () => {
    const dir = getInstallDirFromArgv({
      'install-dir': '/tmp/kebab',
      installDir: '/tmp/camel',
    });
    expect(dir).toBe('/tmp/kebab');
  });

  it('falls back to process.cwd() when neither flag is set', () => {
    const dir = getInstallDirFromArgv({});
    expect(dir).toBe(process.cwd());
  });

  it('ignores non-string values (defensive against yargs quirks)', () => {
    const dir = getInstallDirFromArgv({ 'install-dir': true, installDir: 42 });
    expect(dir).toBe(process.cwd());
  });
});

describe('resolveJsonOutput', () => {
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    originalIsTTY = process.stdout.isTTY;
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: originalIsTTY,
    });
  });

  it('returns true when --json is passed in a TTY', async () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: true,
    });
    expect(await resolveJsonOutput({ json: true })).toBe(true);
  });

  it('returns false in a TTY with no flags (human-readable default)', async () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: true,
    });
    expect(await resolveJsonOutput({})).toBe(false);
  });

  it('auto-detects JSON when stdout is not a TTY (piped)', async () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: false,
    });
    expect(await resolveJsonOutput({})).toBe(true);
  });

  it('--human overrides non-TTY auto-detect', async () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: false,
    });
    expect(await resolveJsonOutput({ human: true })).toBe(false);
  });

  it('does NOT flip on --agent by default (preserves byte-identical pre-refactor behavior)', async () => {
    // Regression guard for the bug fix in cac446be: detect/status/auth/plan/
    // reset/verify/whoami intentionally do NOT forward `--agent` to
    // jsonOutput. Only `projects` opts in via `forwardAgent: true`.
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: true,
    });
    expect(await resolveJsonOutput({ agent: true })).toBe(false);
  });

  it('forwardAgent: true → --agent flips to JSON output even in a TTY', async () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: true,
    });
    expect(
      await resolveJsonOutput({ agent: true }, { forwardAgent: true }),
    ).toBe(true);
  });
});

describe('extractErrorMessage', () => {
  it('returns .message for Error instances', () => {
    expect(extractErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('falls back to String() for non-Error values', () => {
    expect(extractErrorMessage('plain string')).toBe('plain string');
    expect(extractErrorMessage(42)).toBe('42');
    expect(extractErrorMessage({ msg: 'object' })).toBe('[object Object]');
    expect(extractErrorMessage(null)).toBe('null');
    expect(extractErrorMessage(undefined)).toBe('undefined');
  });

  it('handles Error subclasses', () => {
    class CustomError extends Error {}
    expect(extractErrorMessage(new CustomError('custom'))).toBe('custom');
  });
});
