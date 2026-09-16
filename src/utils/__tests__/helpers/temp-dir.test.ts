/**
 * Tests for the shared `createTempDir` helper used across the test suite.
 *
 * These are intentionally narrow: the helper exists to dedupe ~75 inlined
 * `mkdtempSync` + `rmSync` blocks, so we just need to confirm it produces a
 * fresh directory and that `cleanup` is idempotent.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createTempDir } from './temp-dir.js';

describe('createTempDir', () => {
  it('creates a fresh, existing directory under os.tmpdir()', () => {
    const { dir, cleanup } = createTempDir('temp-dir-helper-');
    try {
      expect(fs.existsSync(dir)).toBe(true);
      expect(fs.statSync(dir).isDirectory()).toBe(true);
      // os.tmpdir() may be a symlink (e.g. /tmp -> /private/tmp on macOS).
      // mkdtempSync returns the un-resolved path, so compare via realpath on
      // both sides.
      expect(fs.realpathSync(path.dirname(dir))).toBe(
        fs.realpathSync(os.tmpdir()),
      );
      expect(path.basename(dir)).toMatch(/^temp-dir-helper-/);
    } finally {
      cleanup();
    }
  });

  it('appends a trailing dash to the prefix when missing', () => {
    const { dir, cleanup } = createTempDir('no-trailing-dash');
    try {
      expect(path.basename(dir)).toMatch(/^no-trailing-dash-/);
    } finally {
      cleanup();
    }
  });

  it('returns a unique directory per invocation', () => {
    const a = createTempDir('temp-dir-unique-');
    const b = createTempDir('temp-dir-unique-');
    try {
      expect(a.dir).not.toBe(b.dir);
    } finally {
      a.cleanup();
      b.cleanup();
    }
  });

  it('cleanup removes the directory and is safe to call twice', () => {
    const { dir, cleanup } = createTempDir('temp-dir-cleanup-');
    fs.writeFileSync(path.join(dir, 'file.txt'), 'hello');
    expect(fs.existsSync(dir)).toBe(true);
    cleanup();
    expect(fs.existsSync(dir)).toBe(false);
    // Second call must not throw.
    expect(() => cleanup()).not.toThrow();
  });

  it('uses a default prefix when none is provided', () => {
    const { dir, cleanup } = createTempDir();
    try {
      expect(path.basename(dir)).toMatch(/^wizard-test-/);
    } finally {
      cleanup();
    }
  });
});
