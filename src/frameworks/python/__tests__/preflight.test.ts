/**
 * Tests for `hasPythonProjectMarkers`. The detector hot path calls this
 * synchronously to short-circuit recursive `fast-glob` scans on JS-heavy
 * repos. Behaviour we lock in:
 *
 *   1. Returns true for any single canonical top-level marker.
 *   2. Returns true for `requirements*.txt` variants we don't list
 *      explicitly (catch-all readdir branch).
 *   3. Returns false for an install dir with no python markers, EVEN
 *      WHEN there are python markers in subdirectories — that's the
 *      whole point of this preflight.
 *   4. Returns false (no throw) when the install dir is missing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { hasPythonProjectMarkers, PYTHON_TOPLEVEL_MARKERS } from '../preflight';
import { createTempDir } from '../../../utils/__tests__/helpers/temp-dir.js';

describe('hasPythonProjectMarkers', () => {
  let tmpDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ dir: tmpDir, cleanup } = createTempDir('preflight-'));
  });

  afterEach(() => {
    cleanup();
  });

  it('returns false on an empty directory', () => {
    expect(hasPythonProjectMarkers(tmpDir)).toBe(false);
  });

  it('returns false on a JS-only project (the exact scenario we are fixing)', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.mkdirSync(path.join(tmpDir, 'node_modules'));
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'lodash'));
    fs.writeFileSync(
      path.join(tmpDir, 'node_modules', 'lodash', 'package.json'),
      '{}',
    );
    expect(hasPythonProjectMarkers(tmpDir)).toBe(false);
  });

  for (const marker of PYTHON_TOPLEVEL_MARKERS) {
    it(`returns true when ${marker} is present at root`, () => {
      fs.writeFileSync(path.join(tmpDir, marker), '');
      expect(hasPythonProjectMarkers(tmpDir)).toBe(true);
    });
  }

  it('returns true for requirements*.txt variants not in the explicit list', () => {
    fs.writeFileSync(path.join(tmpDir, 'requirements-staging.txt'), '');
    expect(hasPythonProjectMarkers(tmpDir)).toBe(true);
  });

  it('does NOT recurse — python markers in a subdir return false', () => {
    fs.mkdirSync(path.join(tmpDir, 'services'));
    fs.mkdirSync(path.join(tmpDir, 'services', 'api'));
    fs.writeFileSync(path.join(tmpDir, 'services', 'api', 'manage.py'), '');
    expect(hasPythonProjectMarkers(tmpDir)).toBe(false);
  });

  it('returns false on a non-existent install dir without throwing', () => {
    const missing = path.join(tmpDir, 'does-not-exist');
    expect(() => hasPythonProjectMarkers(missing)).not.toThrow();
    expect(hasPythonProjectMarkers(missing)).toBe(false);
  });

  it('completes synchronously and quickly even on a large JS tree', () => {
    // 100 fake transitive deps — would push fast-glob over the 10s
    // timeout on the old path. Sync existsSync is constant-time.
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.mkdirSync(path.join(tmpDir, 'node_modules'));
    for (let i = 0; i < 100; i++) {
      const dep = path.join(tmpDir, 'node_modules', `pkg-${i}`);
      fs.mkdirSync(dep);
      fs.writeFileSync(path.join(dep, 'package.json'), '{}');
    }
    const start = Date.now();
    const result = hasPythonProjectMarkers(tmpDir);
    const elapsed = Date.now() - start;
    expect(result).toBe(false);
    // Generous bound — we just need to prove this isn't paying the
    // 10s recursive-glob cost. In practice this test runs in <10ms.
    expect(elapsed).toBeLessThan(500);
  });
});
