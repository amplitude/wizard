/**
 * Tests for src/utils/ampli-settings.ts
 * Covers read/write/token-expiry logic with a mocked `node:fs`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';

vi.mock('node:fs');

// Re-import after mock is in place
import {
  getStoredUser,
  getStoredToken,
  storeToken,
  clearStoredCredentials,
  type StoredUser,
  type StoredOAuthToken,
} from '../ampli-settings.js';

const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);

// ── in-memory fs ───────────────────────────────────────────────────────────
// readFileSync and writeFileSync are wired to the same store so that
// storeToken → writeFileSync → readFileSync → getStoredToken round-trips work.

let fsStore = '{}';

beforeEach(() => {
  vi.clearAllMocks();
  fsStore = '{}';
  mockReadFileSync.mockImplementation(() => fsStore as unknown as Buffer);
  mockWriteFileSync.mockImplementation((_path, data) => {
    fsStore = data as string;
  });
});

function setupConfig(data: Record<string, unknown>) {
  fsStore = JSON.stringify(data);
  mockReadFileSync.mockImplementation(() => fsStore as unknown as Buffer);
}

// ── helpers ────────────────────────────────────────────────────────────────

const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 h from now
const ANCIENT = new Date('2020-01-01').toISOString(); // definitely expired refresh window

function makeUserEntry(
  userId: string,
  overrides: Partial<Record<string, string>> = {},
  userOverrides: Partial<StoredUser> = {},
) {
  return {
    [`User-${userId}`]: {
      User: {
        id: userId,
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        zone: 'us' as const,
        ...userOverrides,
      },
      OAuthAccessToken: 'access-token',
      OAuthIdToken: 'id-token',
      OAuthRefreshToken: 'refresh-token',
      OAuthExpiresAt: FUTURE,
      ...overrides,
    },
  };
}


// ── getStoredUser ──────────────────────────────────────────────────────────

describe('getStoredUser', () => {
  it('returns the first stored user', () => {
    setupConfig(makeUserEntry('123'));
    const user = getStoredUser();
    expect(user).toEqual({
      id: '123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      zone: 'us',
    });
  });

  it('returns undefined when config is empty', () => {
    setupConfig({});
    expect(getStoredUser()).toBeUndefined();
  });

  it('returns undefined when entry has no User field', () => {
    setupConfig({ 'User-abc': { OAuthAccessToken: 'tok' } });
    expect(getStoredUser()).toBeUndefined();
  });

  it('returns undefined when file is missing (readFileSync throws)', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(getStoredUser()).toBeUndefined();
  });

  it('returns undefined when file contains invalid JSON', () => {
    mockReadFileSync.mockReturnValue('not json' as unknown as Buffer);
    expect(getStoredUser()).toBeUndefined();
  });

  it('ignores keys that do not start with User-', () => {
    setupConfig({ Settings: { User: { id: 'x' } } });
    expect(getStoredUser()).toBeUndefined();
  });
});

// ── getStoredToken ─────────────────────────────────────────────────────────

describe('getStoredToken', () => {
  it('returns a valid token', () => {
    setupConfig(makeUserEntry('123'));
    const token = getStoredToken();
    expect(token).toEqual({
      accessToken: 'access-token',
      idToken: 'id-token',
      refreshToken: 'refresh-token',
      expiresAt: FUTURE,
    });
  });

  it('returns undefined when config is empty', () => {
    setupConfig({});
    expect(getStoredToken()).toBeUndefined();
  });

  it('returns undefined when file is missing', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(getStoredToken()).toBeUndefined();
  });

  it('returns undefined when OAuthAccessToken is missing', () => {
    const entry = makeUserEntry('123');
    delete (entry['User-123'] as Record<string, unknown>)['OAuthAccessToken'];
    setupConfig(entry);
    expect(getStoredToken()).toBeUndefined();
  });

  it('returns undefined when OAuthIdToken is missing', () => {
    const entry = makeUserEntry('123');
    delete (entry['User-123'] as Record<string, unknown>)['OAuthIdToken'];
    setupConfig(entry);
    expect(getStoredToken()).toBeUndefined();
  });

  it('returns undefined when OAuthRefreshToken is missing', () => {
    const entry = makeUserEntry('123');
    delete (entry['User-123'] as Record<string, unknown>)['OAuthRefreshToken'];
    setupConfig(entry);
    expect(getStoredToken()).toBeUndefined();
  });

  it('returns undefined when refresh window has expired', () => {
    setupConfig(makeUserEntry('123', { OAuthExpiresAt: ANCIENT }));
    expect(getStoredToken()).toBeUndefined();
  });

  it('returns token when looking up by userId', () => {
    setupConfig(makeUserEntry('123'));
    expect(getStoredToken('123')).toBeDefined();
  });

  it('returns undefined for unknown userId', () => {
    setupConfig(makeUserEntry('123'));
    expect(getStoredToken('999')).toBeUndefined();
  });

  it('finds a token stored under a User[ zone key', () => {
    setupConfig({
      'User[eu]-456': {
        User: {
          id: '456',
          firstName: 'X',
          lastName: 'Y',
          email: 'x@y.com',
          zone: 'eu',
        },
        OAuthAccessToken: 'eu-access',
        OAuthIdToken: 'eu-id',
        OAuthRefreshToken: 'eu-refresh',
        OAuthExpiresAt: FUTURE,
      },
    });
    const token = getStoredToken(undefined, 'eu');
    expect(token?.accessToken).toBe('eu-access');
  });

  it('sanitizes dots in userId when looking up', () => {
    // userId with dots → stored as User-user-example-com
    setupConfig({
      'User-user-example-com': {
        User: {
          id: 'user.example.com',
          firstName: '',
          lastName: '',
          email: '',
          zone: 'us',
        },
        OAuthAccessToken: 'a',
        OAuthIdToken: 'b',
        OAuthRefreshToken: 'c',
        OAuthExpiresAt: FUTURE,
      },
    });
    expect(getStoredToken('user.example.com')).toBeDefined();
  });
});

// ── storeToken ─────────────────────────────────────────────────────────────

describe('storeToken', () => {
  const user: StoredUser = {
    id: '42',
    firstName: 'Grace',
    lastName: 'Hopper',
    email: 'grace@example.com',
    zone: 'us',
  };
  const token: StoredOAuthToken = {
    accessToken: 'acc',
    idToken: 'idt',
    refreshToken: 'ref',
    expiresAt: FUTURE,
  };

  beforeEach(() => {
    setupConfig({});
  });

  it('writes the token in the expected shape', () => {
    storeToken(user, token);
    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    expect(written['User-42']).toMatchObject({
      User: user,
      OAuthAccessToken: 'acc',
      OAuthIdToken: 'idt',
      OAuthRefreshToken: 'ref',
      OAuthExpiresAt: FUTURE,
    });
  });

  it('merges with existing config rather than overwriting it', () => {
    const existing = makeUserEntry('99');
    setupConfig(existing);
    storeToken(user, token);
    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    expect(written['User-99']).toBeDefined();
    expect(written['User-42']).toBeDefined();
  });

  it('uses User[eu]-{id} key for EU zone', () => {
    storeToken({ ...user, zone: 'eu' }, token);
    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    expect(written['User[eu]-42']).toBeDefined();
    expect(written['User-42']).toBeUndefined();
  });

  it('sanitizes dots in userId', () => {
    storeToken({ ...user, id: 'a.b.c' }, token);
    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    expect(written['User-a-b-c']).toBeDefined();
  });

  it('overwrites previous token for the same user', () => {
    setupConfig(makeUserEntry('42'));
    storeToken(user, { ...token, accessToken: 'new-acc' });
    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    expect(written['User-42'].OAuthAccessToken).toBe('new-acc');
  });

  it('passes configPath through to fs', () => {
    storeToken(user, token, '/custom/path.json');
    expect(mockWriteFileSync.mock.calls[0][0]).toBe('/custom/path.json');
  });
});

describe('store then get token', () => {
  it('returns the same token that was stored', () => {
    const user: StoredUser = {
      id: '55',
      firstName: 'Katherine',
      lastName: 'Johnson',
      email: 'katherine.johnson@example.com',
      zone: 'us',
    };
    const token: StoredOAuthToken = {
      accessToken: 'acc',
      idToken: 'idt',
      refreshToken: 'ref',
      expiresAt: FUTURE,
    };
    storeToken(user, token);
    const retrieved = getStoredToken('55');
    expect(retrieved).toEqual(token);
  });
});

// ── clearStoredCredentials ─────────────────────────────────────────────────

describe('clearStoredCredentials', () => {
  it('writes an empty object', () => {
    clearStoredCredentials();
    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    expect(written).toEqual({});
  });

  it('passes configPath through to fs', () => {
    clearStoredCredentials('/custom/path.json');
    expect(mockWriteFileSync.mock.calls[0][0]).toBe('/custom/path.json');
  });
});
