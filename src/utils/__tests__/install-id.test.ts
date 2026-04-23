/**
 * Tests for src/utils/install-id.ts
 * Uses a real temp directory to validate file permissions and atomic writes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getOrCreateInstallId } from '../install-id.js';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('install-id', () => {
  let tmpRoot: string;
  let filePath: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-install-id-'));
    filePath = path.join(tmpRoot, 'nested', 'install.json');
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('creates a new UUID and persists it when the file is missing', () => {
    const id = getOrCreateInstallId(filePath);

    expect(id).toMatch(UUID_V4);
    expect(fs.existsSync(filePath)).toBe(true);

    const stored = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
      installId: string;
      createdAt: string;
    };
    expect(stored.installId).toBe(id);
    expect(() => new Date(stored.createdAt).toISOString()).not.toThrow();
  });

  it('reuses the persisted UUID on subsequent calls', () => {
    const first = getOrCreateInstallId(filePath);
    const second = getOrCreateInstallId(filePath);
    const third = getOrCreateInstallId(filePath);

    expect(first).toMatch(UUID_V4);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('regenerates on corrupt JSON without throwing', () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '{ not valid json', 'utf-8');

    const id = getOrCreateInstallId(filePath);
    expect(id).toMatch(UUID_V4);

    const stored = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
      installId: string;
    };
    expect(stored.installId).toBe(id);
  });

  it('regenerates when the record fails schema validation', () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({ installId: 'not-a-uuid', createdAt: 'whenever' }),
      'utf-8',
    );

    const id = getOrCreateInstallId(filePath);
    expect(id).toMatch(UUID_V4);
  });

  it('writes the file with 0o600 permissions (owner read/write only)', () => {
    if (process.platform === 'win32') {
      return; // POSIX permission bits don't apply on Windows
    }

    getOrCreateInstallId(filePath);

    const mode = fs.statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('returns undefined when persistence fails', () => {
    // Point at a path whose parent is an existing file — mkdirSync(recursive) fails.
    const blocker = path.join(tmpRoot, 'blocker');
    fs.writeFileSync(blocker, 'x');
    const unwritable = path.join(blocker, 'install.json');

    const id = getOrCreateInstallId(unwritable);
    expect(id).toBeUndefined();
  });
});
