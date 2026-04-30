import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  persistApiKey,
  readApiKey,
  readApiKeyWithSource,
  clearApiKey,
} from '../api-key-store.js';
import { CACHE_ROOT_OVERRIDE_ENV } from '../storage-paths.js';

/**
 * The api-key-store module now reads/writes a per-user JSON file at
 * `<cacheRoot>/credentials.json` (default `~/.amplitude/wizard/`). Override
 * the cache root to a temp dir so tests don't touch the real user home.
 */

const originalCacheOverride = process.env[CACHE_ROOT_OVERRIDE_ENV];

let tmpDir: string;
let cacheDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-key-store-test-'));
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-key-store-cache-'));
  process.env[CACHE_ROOT_OVERRIDE_ENV] = cacheDir;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(cacheDir, { recursive: true, force: true });
  if (originalCacheOverride === undefined) {
    delete process.env[CACHE_ROOT_OVERRIDE_ENV];
  } else {
    process.env[CACHE_ROOT_OVERRIDE_ENV] = originalCacheOverride;
  }
  delete process.env.AMPLITUDE_API_KEY;
});

// ── persistApiKey ─────────────────────────────────────────────────────────────

describe('persistApiKey', () => {
  it('writes to the per-user cache and returns "cache"', () => {
    expect(persistApiKey('mykey', tmpDir)).toBe('cache');
    const credsPath = path.join(cacheDir, 'credentials.json');
    expect(fs.existsSync(credsPath)).toBe(true);
    const json = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    expect(json.version).toBe(1);
    const entries = Object.values(json.projects) as Array<{ apiKey: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0].apiKey).toBe('mykey');
  });

  it('keeps separate keys for different install dirs in the same cache file', () => {
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-key-other-'));
    try {
      persistApiKey('key-a', tmpDir);
      persistApiKey('key-b', otherDir);

      expect(readApiKey(tmpDir)).toBe('key-a');
      expect(readApiKey(otherDir)).toBe('key-b');
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });

  it('replaces an existing entry on re-persist', () => {
    persistApiKey('first', tmpDir);
    persistApiKey('second', tmpDir);
    expect(readApiKey(tmpDir)).toBe('second');
  });

  it('falls back to .env.local when the cache write fails', () => {
    // Force-fail the cache write by pointing the cache dir at a path that
    // can't be created (a regular file).
    const blocker = path.join(tmpDir, 'blocker');
    fs.writeFileSync(blocker, '');
    process.env[CACHE_ROOT_OVERRIDE_ENV] = path.join(blocker, 'subpath');

    const result = persistApiKey('mykey', tmpDir);
    expect(result).toBe('env');
    const contents = fs.readFileSync(path.join(tmpDir, '.env.local'), 'utf8');
    expect(contents).toContain('AMPLITUDE_API_KEY=mykey');
  });

  it('updates an existing AMPLITUDE_API_KEY entry in .env.local', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env.local'),
      'AMPLITUDE_API_KEY=oldkey\n',
      'utf8',
    );
    // Force the env fallback path
    const blocker = path.join(tmpDir, 'blocker');
    fs.writeFileSync(blocker, '');
    process.env[CACHE_ROOT_OVERRIDE_ENV] = path.join(blocker, 'subpath');

    persistApiKey('newkey', tmpDir);
    const contents = fs.readFileSync(path.join(tmpDir, '.env.local'), 'utf8');
    expect(contents).toContain('AMPLITUDE_API_KEY=newkey');
    expect(contents).not.toContain('oldkey');
  });

  it('appends AMPLITUDE_API_KEY to .env.local that has other vars', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env.local'),
      'OTHER_VAR=foo\n',
      'utf8',
    );
    // Force env fallback
    const blocker = path.join(tmpDir, 'blocker');
    fs.writeFileSync(blocker, '');
    process.env[CACHE_ROOT_OVERRIDE_ENV] = path.join(blocker, 'subpath');

    persistApiKey('newkey', tmpDir);
    const contents = fs.readFileSync(path.join(tmpDir, '.env.local'), 'utf8');
    expect(contents).toContain('OTHER_VAR=foo');
    expect(contents).toContain('AMPLITUDE_API_KEY=newkey');
  });

  // ── .gitignore management ───────────────────────────────────────────────────
  // Only the .env.local fallback path touches .gitignore. Cache writes do
  // not (the cache file lives outside the project tree, so no risk of
  // accidentally committing it).

  it('creates .gitignore with .env.local entry when env fallback fires', () => {
    const blocker = path.join(tmpDir, 'blocker');
    fs.writeFileSync(blocker, '');
    process.env[CACHE_ROOT_OVERRIDE_ENV] = path.join(blocker, 'subpath');

    persistApiKey('key', tmpDir);
    const contents = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(contents).toContain('.env.local');
  });

  it('does not duplicate .env.local in .gitignore when already present', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.env.local\n', 'utf8');
    const blocker = path.join(tmpDir, 'blocker');
    fs.writeFileSync(blocker, '');
    process.env[CACHE_ROOT_OVERRIDE_ENV] = path.join(blocker, 'subpath');

    persistApiKey('key', tmpDir);
    const contents = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    const count = (contents.match(/\.env\.local/g) ?? []).length;
    expect(count).toBe(1);
  });
});

// ── readApiKeyWithSource ───────────────────────────────────────────────────────

describe('readApiKeyWithSource', () => {
  it('reads from the per-user cache when present', () => {
    persistApiKey('cachekey', tmpDir);
    const result = readApiKeyWithSource(tmpDir);
    expect(result).toEqual({ key: 'cachekey', source: 'cache' });
  });

  it('falls through to .env.local when cache is empty', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env.local'),
      'AMPLITUDE_API_KEY=envkey\n',
      'utf8',
    );
    const result = readApiKeyWithSource(tmpDir);
    expect(result).toEqual({ key: 'envkey', source: 'env' });
  });

  it('prefers the cache over .env.local when both are populated', () => {
    persistApiKey('cachekey', tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.env.local'),
      'AMPLITUDE_API_KEY=envkey\n',
      'utf8',
    );
    const result = readApiKeyWithSource(tmpDir);
    expect(result).toEqual({ key: 'cachekey', source: 'cache' });
  });

  it('does NOT fall back to AMPLITUDE_API_KEY env var (prevents cross-project leakage)', () => {
    process.env.AMPLITUDE_API_KEY = 'envvarkey';
    const result = readApiKeyWithSource(tmpDir);
    expect(result).toBeNull();
  });

  it('returns null when no key is found anywhere', () => {
    expect(readApiKeyWithSource(tmpDir)).toBeNull();
  });

  it('ignores .env.local entries for other keys', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env.local'),
      'OTHER_KEY=abc\n',
      'utf8',
    );
    expect(readApiKeyWithSource(tmpDir)).toBeNull();
  });

  it('ignores a corrupt credentials.json without throwing', () => {
    fs.writeFileSync(
      path.join(cacheDir, 'credentials.json'),
      '{ this is not json',
      'utf8',
    );
    fs.writeFileSync(
      path.join(tmpDir, '.env.local'),
      'AMPLITUDE_API_KEY=fallback\n',
      'utf8',
    );
    const result = readApiKeyWithSource(tmpDir);
    expect(result).toEqual({ key: 'fallback', source: 'env' });
  });
});

// ── readApiKey ────────────────────────────────────────────────────────────────

describe('readApiKey', () => {
  it('returns the key string when found', () => {
    persistApiKey('thekey', tmpDir);
    expect(readApiKey(tmpDir)).toBe('thekey');
  });

  it('returns null when no key is found', () => {
    expect(readApiKey(tmpDir)).toBeNull();
  });
});

// ── clearApiKey ──────────────────────────────────────────────────────────────

describe('clearApiKey', () => {
  it('removes the cache entry for this install dir but leaves others alone', () => {
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-key-other-'));
    try {
      persistApiKey('key-a', tmpDir);
      persistApiKey('key-b', otherDir);

      clearApiKey(tmpDir);

      expect(readApiKey(tmpDir)).toBeNull();
      expect(readApiKey(otherDir)).toBe('key-b');
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });

  it('strips AMPLITUDE_API_KEY from .env.local without removing other vars', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env.local'),
      'AMPLITUDE_API_KEY=somekey\nOTHER_VAR=keep\n',
      'utf8',
    );
    clearApiKey(tmpDir);
    const contents = fs.readFileSync(path.join(tmpDir, '.env.local'), 'utf8');
    expect(contents).not.toContain('AMPLITUDE_API_KEY');
    expect(contents).toContain('OTHER_VAR=keep');
  });

  it('is a no-op when nothing is stored', () => {
    expect(() => clearApiKey(tmpDir)).not.toThrow();
  });
});

// ── credentials.json mode 0o600 ────────────────────────────────────────────

describe.skipIf(process.platform === 'win32')(
  'persistApiKey — credentials.json mode hardening',
  () => {
    it('writes credentials.json at 0o600', () => {
      persistApiKey('apikey1', tmpDir);
      const stat = fs.statSync(path.join(cacheDir, 'credentials.json'));
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it('keeps mode 0o600 across re-persists', () => {
      persistApiKey('first', tmpDir);
      persistApiKey('second', tmpDir);
      const stat = fs.statSync(path.join(cacheDir, 'credentials.json'));
      expect(stat.mode & 0o777).toBe(0o600);
    });
  },
);

// ── F5 regression: .env.local is mode 0o600 on POSIX ──────────────────────────

describe.skipIf(process.platform === 'win32')(
  'persistApiKey — .env.local mode hardening',
  () => {
    /** Force the .env.local fallback by making cache writes fail. */
    function forceEnvFallback(): void {
      const blocker = path.join(tmpDir, 'blocker');
      fs.writeFileSync(blocker, '');
      process.env[CACHE_ROOT_OVERRIDE_ENV] = path.join(blocker, 'subpath');
    }

    it('creates a fresh .env.local at 0o600', () => {
      forceEnvFallback();
      persistApiKey('apikey1', tmpDir);
      const stat = fs.statSync(path.join(tmpDir, '.env.local'));
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it('tightens an existing 0o644 .env.local to 0o600', () => {
      forceEnvFallback();
      const envPath = path.join(tmpDir, '.env.local');
      fs.writeFileSync(envPath, 'OTHER_VAR=foo\n', { mode: 0o644 });
      expect(fs.statSync(envPath).mode & 0o777).toBe(0o644);

      persistApiKey('apikey2', tmpDir);

      expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);
      expect(fs.readFileSync(envPath, 'utf8')).toContain(
        'AMPLITUDE_API_KEY=apikey2',
      );
    });

    it('keeps mode at 0o600 after replacing an existing key', () => {
      forceEnvFallback();
      const envPath = path.join(tmpDir, '.env.local');
      fs.writeFileSync(envPath, 'AMPLITUDE_API_KEY=oldkey\n', { mode: 0o644 });

      persistApiKey('newkey', tmpDir);

      expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);
      expect(fs.readFileSync(envPath, 'utf8')).toContain(
        'AMPLITUDE_API_KEY=newkey',
      );
    });
  },
);
