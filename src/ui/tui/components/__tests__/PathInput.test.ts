/**
 * PathInput unit tests — pin the path-resolution + validation logic.
 *
 * The component itself is hard to test in isolation (Ink + @inkjs/ui
 * TextInput render through fakes), but the meat of the logic lives in
 * the exported `resolveUserPath` and `validatePath` helpers. Those
 * are pure functions of input + filesystem state.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { resolveUserPath, validatePath } from '../PathInput.js';

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
    // We intentionally don't try to look up other users' home dirs —
    // `~someone` falls through and resolves as a literal directory name.
    const result = resolveUserPath('~someone/foo');
    expect(result).toContain('~someone');
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
    // This relies on $HOME being a real directory, which it always is
    // in any environment that runs vitest.
    const result = validatePath('~');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.absolutePath).toBe(homedir());
  });
});
