/**
 * PathInput unit tests — pin the path-resolution + validation logic
 * AND the completion helpers used by the controlled input.
 *
 * The Ink component itself is hard to test in isolation (cursor /
 * candidate rendering), so we extract the meat as pure helpers and
 * test those: stem splitting, completion-dir resolution, candidate
 * computation against a real tmp filesystem, longest-common-prefix,
 * and `applyCompletion` string substitution.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  resolveUserPath,
  validatePath,
  splitStem,
  resolveCompletionDir,
  computeCompletions,
  longestCommonPrefix,
  applyCompletion,
} from '../PathInput.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wizard-path-input-'));
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe('resolveUserPath', () => {
  it('returns absolute paths unchanged', () => {
    expect(resolveUserPath('/etc/hosts')).toBe('/etc/hosts');
  });

  it('expands a leading ~ to the home directory', () => {
    expect(resolveUserPath('~/projects/foo')).toBe(
      join(homedir(), 'projects', 'foo'),
    );
  });

  it('expands a bare ~ to the home directory', () => {
    expect(resolveUserPath('~')).toBe(homedir());
  });

  it('does NOT expand ~user (only the bare ~ form)', () => {
    const result = resolveUserPath('~someone/foo');
    expect(result).toContain('~someone');
  });

  // Regression: bugbot Issue #3.
  it('expands a Windows-style ~\\ prefix the same as ~/', () => {
    expect(resolveUserPath('~\\projects\\foo')).toBe(
      homedir() + '\\projects\\foo',
    );
  });

  it('resolves relative paths against cwd', () => {
    const result = resolveUserPath('./relative/path');
    expect(isAbsolute(result)).toBe(true);
    expect(result.endsWith('relative/path')).toBe(true);
  });

  it('trims surrounding whitespace before resolving', () => {
    expect(resolveUserPath('  /etc  ')).toBe('/etc');
  });
});

describe('validatePath', () => {
  it('rejects empty input', () => {
    const result = validatePath('');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/enter a path/i);
  });

  it('rejects whitespace-only input', () => {
    expect(validatePath('   ').ok).toBe(false);
  });

  it('rejects paths that do not exist', () => {
    const result = validatePath(join(dir, 'does-not-exist'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no directory/i);
  });

  it('rejects paths that point at a file (not a directory)', () => {
    const filePath = join(dir, 'a-file.txt');
    writeFileSync(filePath, 'hi');
    const result = validatePath(filePath);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/file, not a directory/i);
  });

  it('accepts an existing directory and returns the absolute path', () => {
    const result = validatePath(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.absolutePath).toBe(dir);
      expect(isAbsolute(result.absolutePath)).toBe(true);
    }
  });

  it('expands ~ before validating', () => {
    const result = validatePath('~');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.absolutePath).toBe(homedir());
  });
});

describe('splitStem', () => {
  it('returns empty stem and the whole input as partial when no slash', () => {
    expect(splitStem('myfolder')).toEqual({ stem: '', partial: 'myfolder' });
  });

  it('handles the empty string', () => {
    expect(splitStem('')).toEqual({ stem: '', partial: '' });
  });

  it('splits on the LAST slash', () => {
    expect(splitStem('~/projects/my-')).toEqual({
      stem: '~/projects/',
      partial: 'my-',
    });
  });

  it('preserves a trailing slash with empty partial', () => {
    expect(splitStem('~/')).toEqual({ stem: '~/', partial: '' });
    expect(splitStem('/usr/local/')).toEqual({
      stem: '/usr/local/',
      partial: '',
    });
  });

  it('handles a bare slash', () => {
    expect(splitStem('/etc')).toEqual({ stem: '/', partial: 'etc' });
  });
});

describe('resolveCompletionDir', () => {
  it('returns cwd for an empty stem', () => {
    expect(resolveCompletionDir('', '/tmp/cwd')).toBe('/tmp/cwd');
  });

  it('returns root for a bare-slash stem', () => {
    expect(resolveCompletionDir('/', '/tmp/cwd')).toBe('/');
  });

  it('expands a tilde-rooted stem to the home directory', () => {
    expect(resolveCompletionDir('~/', '/tmp/cwd')).toBe(homedir());
  });

  it('expands a tilde-rooted stem with subpath', () => {
    expect(resolveCompletionDir('~/projects/', '/tmp/cwd')).toBe(
      homedir() + '/projects',
    );
  });

  it('resolves an absolute stem unchanged (sans trailing slash)', () => {
    expect(resolveCompletionDir('/usr/local/', '/tmp/cwd')).toBe('/usr/local');
  });

  it('joins relative stems against cwd', () => {
    expect(resolveCompletionDir('projects/', '/tmp/cwd')).toBe(
      '/tmp/cwd/projects',
    );
  });
});

describe('computeCompletions', () => {
  it('returns directories whose names start with the partial', () => {
    mkdirSync(join(dir, 'projects'));
    mkdirSync(join(dir, 'project-x'));
    mkdirSync(join(dir, 'photos'));
    mkdirSync(join(dir, 'docs'));

    const result = computeCompletions('proj', dir);
    expect(result.partial).toBe('proj');
    expect(result.candidates.map((c) => c.name).sort()).toEqual([
      'project-x',
      'projects',
    ]);
  });

  it('skips files', () => {
    mkdirSync(join(dir, 'projects'));
    writeFileSync(join(dir, 'project.md'), 'hi');

    const result = computeCompletions('proj', dir);
    expect(result.candidates.map((c) => c.name)).toEqual(['projects']);
  });

  it('hides dotfiles unless the partial starts with a dot', () => {
    mkdirSync(join(dir, '.git'));
    mkdirSync(join(dir, '.cache'));
    mkdirSync(join(dir, 'visible'));

    const noDot = computeCompletions('', dir);
    expect(noDot.candidates.map((c) => c.name)).toEqual(['visible']);

    const withDot = computeCompletions('.', dir);
    expect(withDot.candidates.map((c) => c.name).sort()).toEqual([
      '.cache',
      '.git',
    ]);
  });

  it('returns empty candidates when the partial matches nothing', () => {
    mkdirSync(join(dir, 'alpha'));
    const result = computeCompletions('zzz', dir);
    expect(result.candidates).toEqual([]);
  });

  it('returns empty candidates when the directory does not exist', () => {
    const result = computeCompletions('foo', join(dir, 'missing'));
    expect(result.candidates).toEqual([]);
  });

  it('completes against an absolute stem', () => {
    mkdirSync(join(dir, 'foo'));
    mkdirSync(join(dir, 'foobar'));
    // Use the tmp dir as the absolute stem to test absolute resolution.
    const input = `${dir}/foo`;
    const result = computeCompletions(input, '/should-not-be-used');
    expect(result.candidates.map((c) => c.name).sort()).toEqual([
      'foo',
      'foobar',
    ]);
  });
});

describe('longestCommonPrefix', () => {
  it('returns an empty string for an empty list', () => {
    expect(longestCommonPrefix([])).toBe('');
  });

  it('returns the only item for a singleton list', () => {
    expect(longestCommonPrefix(['hello'])).toBe('hello');
  });

  it('returns the shared prefix across all items', () => {
    expect(longestCommonPrefix(['project-x', 'projects', 'projection'])).toBe(
      'project',
    );
  });

  it('returns empty when items diverge from the first character', () => {
    expect(longestCommonPrefix(['alpha', 'beta'])).toBe('');
  });
});

describe('applyCompletion', () => {
  it('replaces the trailing partial with the candidate name', () => {
    expect(applyCompletion('~/proj', 'projects')).toBe('~/projects');
  });

  it('appends a separator when requested', () => {
    expect(applyCompletion('~/proj', 'projects', true)).toBe('~/projects/');
  });

  it('handles an empty stem (no slash in input yet)', () => {
    expect(applyCompletion('my', 'myfolder', true)).toBe('myfolder/');
  });

  it('preserves the stem exactly', () => {
    expect(applyCompletion('/usr/local/sh', 'share', true)).toBe(
      '/usr/local/share/',
    );
  });
});
