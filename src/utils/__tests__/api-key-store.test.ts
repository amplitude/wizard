import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'node:child_process';
import {
  persistApiKey,
  readApiKey,
  readApiKeyWithSource,
} from '../api-key-store.js';

// Implementation uses execFileSync (see F2 shell-injection fix); tests
// mock that rather than execSync.
const mockExecSync = vi.mocked(execFileSync);

// ── helpers ───────────────────────────────────────────────────────────────────

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
}

// ── persistApiKey ─────────────────────────────────────────────────────────────

describe('persistApiKey', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-key-store-test-'));
    mockExecSync.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    setPlatform(originalPlatform);
    delete process.env.AMPLITUDE_API_KEY;
  });

  // ── macOS keychain ──────────────────────────────────────────────────────────

  it('returns "keychain" when macOS keychain write succeeds', () => {
    setPlatform('darwin');
    mockExecSync.mockReturnValue('' as ReturnType<typeof execFileSync>);
    expect(persistApiKey('mykey', tmpDir)).toBe('keychain');
  });

  it('falls back to env when macOS keychain write fails', () => {
    setPlatform('darwin');
    mockExecSync.mockImplementation(() => {
      throw new Error('keychain error');
    });
    const result = persistApiKey('mykey', tmpDir);
    expect(result).toBe('env');
    const contents = fs.readFileSync(path.join(tmpDir, '.env.local'), 'utf8');
    expect(contents).toContain('AMPLITUDE_API_KEY=mykey');
  });

  // ── Linux secret-tool ───────────────────────────────────────────────────────

  it('returns "keychain" when Linux secret-tool write succeeds', () => {
    setPlatform('linux');
    mockExecSync.mockReturnValue('' as ReturnType<typeof execFileSync>);
    expect(persistApiKey('mykey', tmpDir)).toBe('keychain');
  });

  it('falls back to env when Linux secret-tool write fails', () => {
    setPlatform('linux');
    mockExecSync.mockImplementation(() => {
      throw new Error('secret-tool error');
    });
    expect(persistApiKey('mykey', tmpDir)).toBe('env');
  });

  // ── .env.local fallback ─────────────────────────────────────────────────────

  it('writes to .env.local on non-darwin/linux platforms', () => {
    setPlatform('win32');
    const result = persistApiKey('testkey', tmpDir);
    expect(result).toBe('env');
    const contents = fs.readFileSync(path.join(tmpDir, '.env.local'), 'utf8');
    expect(contents).toContain('AMPLITUDE_API_KEY=testkey');
  });

  it('updates an existing AMPLITUDE_API_KEY entry in .env.local', () => {
    setPlatform('win32');
    fs.writeFileSync(
      path.join(tmpDir, '.env.local'),
      'AMPLITUDE_API_KEY=oldkey\n',
      'utf8',
    );
    persistApiKey('newkey', tmpDir);
    const contents = fs.readFileSync(path.join(tmpDir, '.env.local'), 'utf8');
    expect(contents).toContain('AMPLITUDE_API_KEY=newkey');
    expect(contents).not.toContain('oldkey');
  });

  it('appends AMPLITUDE_API_KEY to .env.local that has other vars', () => {
    setPlatform('win32');
    fs.writeFileSync(
      path.join(tmpDir, '.env.local'),
      'OTHER_VAR=foo\n',
      'utf8',
    );
    persistApiKey('newkey', tmpDir);
    const contents = fs.readFileSync(path.join(tmpDir, '.env.local'), 'utf8');
    expect(contents).toContain('OTHER_VAR=foo');
    expect(contents).toContain('AMPLITUDE_API_KEY=newkey');
  });

  // ── .gitignore management ───────────────────────────────────────────────────

  it('creates .gitignore with .env.local entry when no .gitignore exists', () => {
    setPlatform('win32');
    persistApiKey('key', tmpDir);
    const contents = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(contents).toContain('.env.local');
  });

  it('appends .env.local to an existing .gitignore that lacks it', () => {
    setPlatform('win32');
    fs.writeFileSync(
      path.join(tmpDir, '.gitignore'),
      '*.log\nnode_modules\n',
      'utf8',
    );
    persistApiKey('key', tmpDir);
    const contents = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(contents).toContain('.env.local');
    expect(contents).toContain('*.log');
  });

  it('does not duplicate .env.local in .gitignore when already present', () => {
    setPlatform('win32');
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.env.local\n', 'utf8');
    persistApiKey('key', tmpDir);
    const contents = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
    const count = (contents.match(/\.env\.local/g) ?? []).length;
    expect(count).toBe(1);
  });
});

// ── readApiKeyWithSource ───────────────────────────────────────────────────────

describe('readApiKeyWithSource', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-key-store-read-test-'));
    mockExecSync.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    setPlatform(originalPlatform);
    delete process.env.AMPLITUDE_API_KEY;
  });

  it('reads from macOS keychain when available', () => {
    setPlatform('darwin');
    mockExecSync.mockReturnValue(
      'keychainkey\n' as ReturnType<typeof execFileSync>,
    );
    const result = readApiKeyWithSource(tmpDir);
    expect(result).toEqual({ key: 'keychainkey', source: 'keychain' });
  });

  it('reads from Linux secret-tool when available', () => {
    setPlatform('linux');
    mockExecSync.mockReturnValue(
      'linuxkey\n' as ReturnType<typeof execFileSync>,
    );
    const result = readApiKeyWithSource(tmpDir);
    expect(result).toEqual({ key: 'linuxkey', source: 'keychain' });
  });

  it('falls through to .env.local when macOS keychain throws', () => {
    setPlatform('darwin');
    mockExecSync.mockImplementation(() => {
      throw new Error('not found');
    });
    fs.writeFileSync(
      path.join(tmpDir, '.env.local'),
      'AMPLITUDE_API_KEY=fallback\n',
      'utf8',
    );
    const result = readApiKeyWithSource(tmpDir);
    expect(result).toEqual({ key: 'fallback', source: 'env' });
  });

  it('reads from .env.local on non-darwin/linux', () => {
    setPlatform('win32');
    fs.writeFileSync(
      path.join(tmpDir, '.env.local'),
      'AMPLITUDE_API_KEY=envkey\n',
      'utf8',
    );
    const result = readApiKeyWithSource(tmpDir);
    expect(result).toEqual({ key: 'envkey', source: 'env' });
  });

  it('does NOT fall back to AMPLITUDE_API_KEY env var (prevents cross-project leakage)', () => {
    setPlatform('win32');
    process.env.AMPLITUDE_API_KEY = 'envvarkey';
    const result = readApiKeyWithSource(tmpDir);
    // Shell-level env vars would leak across projects — only .env.local is project-scoped
    expect(result).toBeNull();
  });

  it('returns null when no key is found anywhere', () => {
    setPlatform('win32');
    expect(readApiKeyWithSource(tmpDir)).toBeNull();
  });

  it('ignores .env.local entries for other keys', () => {
    setPlatform('win32');
    fs.writeFileSync(
      path.join(tmpDir, '.env.local'),
      'OTHER_KEY=abc\n',
      'utf8',
    );
    expect(readApiKeyWithSource(tmpDir)).toBeNull();
  });
});

// ── readApiKey ────────────────────────────────────────────────────────────────

describe('readApiKey', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'api-key-store-readkey-test-'),
    );
    mockExecSync.mockReset();
    setPlatform('win32');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    setPlatform(originalPlatform);
    delete process.env.AMPLITUDE_API_KEY;
  });

  it('returns the key string when found', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env.local'),
      'AMPLITUDE_API_KEY=thekey\n',
      'utf8',
    );
    expect(readApiKey(tmpDir)).toBe('thekey');
  });

  it('returns null when no key is found', () => {
    expect(readApiKey(tmpDir)).toBeNull();
  });
});

// ── F5 regression: .env.local is mode 0o600 on POSIX ──────────────────────────

describe.skipIf(process.platform === 'win32')(
  'persistApiKey — .env.local mode hardening',
  () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-key-mode-test-'));
      mockExecSync.mockReset();
      // Force the .env.local fallback path on POSIX hosts. linux + a
      // failing secret-tool is the simplest way to land in envWrite.
      setPlatform('linux');
      mockExecSync.mockImplementation(() => {
        throw new Error('no secret-tool');
      });
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      setPlatform(originalPlatform);
    });

    it('creates a fresh .env.local at 0o600', () => {
      persistApiKey('apikey1', tmpDir);
      const stat = fs.statSync(path.join(tmpDir, '.env.local'));
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it('tightens an existing 0o644 .env.local to 0o600', () => {
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
