/**
 * install-dir unit tests — pin the path-resolution helpers used by
 * `--install-dir` and the in-app PathInput.
 *
 * The PathInput-specific helpers (`resolveUserPath`, `validatePath`)
 * are covered separately in `ui/tui/components/__tests__/PathInput.test.ts`.
 * This file focuses on `expandTilde` and `resolveInstallDir`, which are
 * the trust-boundary helpers used by the CLI entry points.
 */

import { homedir } from 'node:os';
import { isAbsolute, resolve, sep } from 'node:path';

import { describe, it, expect } from 'vitest';

import { expandTilde, resolveInstallDir } from '../install-dir.js';

describe('expandTilde', () => {
  it('expands a bare ~ to the home directory', () => {
    expect(expandTilde('~')).toBe(homedir());
  });

  it('expands a leading ~/ prefix', () => {
    expect(expandTilde('~/projects/foo')).toBe(homedir() + '/projects/foo');
  });

  it('expands a Windows-style ~\\ prefix', () => {
    // PathInput seeds its default value via `shortenHomePath`, which
    // uses `path.sep` — a backslash on Windows. The seeded value must
    // round-trip through expansion without a "no directory" error.
    expect(expandTilde('~\\projects\\foo')).toBe(homedir() + '\\projects\\foo');
  });

  it('does NOT expand ~user (only the bare ~ form)', () => {
    expect(expandTilde('~someone/foo')).toBe('~someone/foo');
  });

  it('returns absolute paths unchanged', () => {
    expect(expandTilde('/etc/hosts')).toBe('/etc/hosts');
  });

  it('returns relative paths unchanged', () => {
    expect(expandTilde('./relative/path')).toBe('./relative/path');
  });

  it('trims surrounding whitespace', () => {
    expect(expandTilde('  /etc  ')).toBe('/etc');
  });
});

describe('resolveInstallDir', () => {
  it('expands ~ before resolving — regression for the "double-tilde" bug', () => {
    // Repro of the original bug:
    //   $ cd ~/excalidraw
    //   $ npx @amplitude/wizard --install-dir="~/random-testing/makeapp"
    //
    // Without `~` expansion, `path.resolve('~/random-testing/makeapp')`
    // returns `<cwd>/~/random-testing/makeapp`. The Target line in the
    // welcome screen then renders `~/excalidraw/~/random-testing/makeapp`.
    expect(
      resolveInstallDir('~/random-testing/makeapp', '/home/user/excalidraw'),
    ).toBe(homedir() + '/random-testing/makeapp');
  });

  it('returns absolute paths unchanged', () => {
    expect(resolveInstallDir('/tmp/work', '/home/user')).toBe('/tmp/work');
  });

  it('resolves relative paths against the supplied cwd', () => {
    expect(resolveInstallDir('./project', '/home/user')).toBe(
      '/home/user/project',
    );
    expect(resolveInstallDir('../sibling', '/home/user/foo')).toBe(
      '/home/user/sibling',
    );
  });

  it('falls back to cwd when input is undefined / null / empty / whitespace', () => {
    expect(resolveInstallDir(undefined, '/home/user')).toBe(
      resolve('/home/user'),
    );
    expect(resolveInstallDir(null, '/home/user')).toBe(resolve('/home/user'));
    expect(resolveInstallDir('', '/home/user')).toBe(resolve('/home/user'));
    expect(resolveInstallDir('   ', '/home/user')).toBe(resolve('/home/user'));
  });

  it('uses process.cwd() when no cwd override is supplied', () => {
    const result = resolveInstallDir('./relative');
    expect(isAbsolute(result)).toBe(true);
    expect(result.endsWith(`relative`)).toBe(true);
    expect(result.startsWith(process.cwd() + sep)).toBe(true);
  });

  it('expands a bare ~', () => {
    expect(resolveInstallDir('~')).toBe(homedir());
  });
});
