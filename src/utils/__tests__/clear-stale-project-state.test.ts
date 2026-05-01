import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  CACHE_ROOT_OVERRIDE_ENV,
  getCheckpointFile,
} from '../storage-paths.js';
import { persistApiKey, readApiKey } from '../api-key-store.js';
import { clearStaleProjectState } from '../clear-stale-project-state.js';

describe('clearStaleProjectState', () => {
  let tmpDir: string;
  let cacheRoot: string;
  let prevCache: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clear-stale-test-'));
    cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clear-stale-cache-'));
    prevCache = process.env[CACHE_ROOT_OVERRIDE_ENV];
    process.env[CACHE_ROOT_OVERRIDE_ENV] = cacheRoot;
  });

  afterEach(() => {
    if (prevCache === undefined) {
      delete process.env[CACHE_ROOT_OVERRIDE_ENV];
    } else {
      process.env[CACHE_ROOT_OVERRIDE_ENV] = prevCache;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  });

  it('strips AMPLITUDE_API_KEY from .env.local while preserving other vars', () => {
    const envPath = path.join(tmpDir, '.env.local');
    fs.writeFileSync(
      envPath,
      'OTHER_VAR=keepme\nAMPLITUDE_API_KEY=stale_key\nANOTHER=alsokeep\n',
    );

    clearStaleProjectState(tmpDir);

    const contents = fs.readFileSync(envPath, 'utf8');
    expect(contents).not.toContain('AMPLITUDE_API_KEY');
    expect(contents).toContain('OTHER_VAR=keepme');
    expect(contents).toContain('ANOTHER=alsokeep');
  });

  it('deletes the checkpoint file at the per-installDir hashed path', () => {
    const checkpointPath = getCheckpointFile(tmpDir);
    fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
    fs.writeFileSync(
      checkpointPath,
      JSON.stringify({ installDir: tmpDir, savedAt: new Date().toISOString() }),
    );
    expect(fs.existsSync(checkpointPath)).toBe(true);

    clearStaleProjectState(tmpDir);

    expect(fs.existsSync(checkpointPath)).toBe(false);
  });

  it('strips OrgId/WorkspaceId/Zone from project ampli.json while preserving tracking-plan fields', () => {
    const ampliJsonPath = path.join(tmpDir, 'ampli.json');
    fs.writeFileSync(
      ampliJsonPath,
      JSON.stringify({
        OrgId: 'old-org',
        WorkspaceId: 'old-ws',
        Zone: 'us',
        SourceId: 'src-1',
        Branch: 'main',
        Version: '42.0.0',
      }),
    );

    clearStaleProjectState(tmpDir);

    const result = JSON.parse(fs.readFileSync(ampliJsonPath, 'utf8'));
    expect(result.OrgId).toBeUndefined();
    expect(result.WorkspaceId).toBeUndefined();
    expect(result.Zone).toBeUndefined();
    expect(result.SourceId).toBe('src-1');
    expect(result.Branch).toBe('main');
    expect(result.Version).toBe('42.0.0');
  });

  it('clears persisted API key from the per-user cache', () => {
    persistApiKey('stale-key-123', tmpDir);
    expect(readApiKey(tmpDir)).toBe('stale-key-123');

    clearStaleProjectState(tmpDir);

    expect(readApiKey(tmpDir)).toBe(null);
  });

  it('is a no-op when no prior state exists', () => {
    expect(() => clearStaleProjectState(tmpDir)).not.toThrow();
    expect(fs.existsSync(getCheckpointFile(tmpDir))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, '.env.local'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'ampli.json'))).toBe(false);
  });
});
