/**
 * Regression tests for atomicWriteJSON mode hardening.
 *
 * Bug we're guarding against: if `~/.ampli.json` was previously created at
 * 0o644 (e.g. by an older wizard build, or by `ampli login`), every later
 * `atomicWriteJSON(path, data, 0o600)` call still left the destination at
 * 0o644 because the mode option to `writeFileSync` only applies on file
 * CREATION, and `renameSync` keeps whatever mode the temp had — but no
 * follow-up `chmod` was ever issued. So OAuth tokens stayed world-readable
 * to other local users.
 *
 * Skipped on Windows because `chmodSync` only honours the read-only bit
 * there; the security-relevant codepath only matters on POSIX hosts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { atomicWriteJSON } from '../atomic-write';

const POSIX = process.platform !== 'win32';

describe.skipIf(!POSIX)('atomicWriteJSON — mode enforcement', () => {
  let tmpDir: string;
  let target: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-test-'));
    target = path.join(tmpDir, 'creds.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a new file at the requested mode', () => {
    atomicWriteJSON(target, { hello: 'world' }, 0o600);
    const stat = fs.statSync(target);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('tightens a pre-existing 0o644 file to 0o600 on next write', () => {
    // Simulate an older wizard run that left the file world-readable.
    fs.writeFileSync(target, '{"old":true}', { mode: 0o644 });
    expect(fs.statSync(target).mode & 0o777).toBe(0o644);

    atomicWriteJSON(target, { fresh: true }, 0o600);

    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({
      fresh: true,
    });
  });

  it('leaves mode untouched when no mode option is provided', () => {
    fs.writeFileSync(target, '{"old":true}', { mode: 0o644 });
    atomicWriteJSON(target, { fresh: true });
    // No chmodSync issued — original mode stays.
    expect(fs.statSync(target).mode & 0o777).toBe(0o644);
  });

  it('accepts the new options object form', () => {
    fs.writeFileSync(target, '{"old":true}', { mode: 0o644 });
    atomicWriteJSON(target, { fresh: true }, { mode: 0o600 });
    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
  });
});
