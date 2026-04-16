import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Mock the auth plumbing — agent-ops shouldn't actually hit ~/.ampli.json.
vi.mock('../../utils/ampli-settings.js', () => ({
  getStoredUser: vi.fn(),
  getStoredToken: vi.fn(),
}));

import {
  getAuthStatus,
  getAuthToken,
  runStatus,
  runDetect,
} from '../agent-ops.js';
import { getStoredUser, getStoredToken } from '../../utils/ampli-settings.js';

const mockedGetStoredUser = vi.mocked(getStoredUser);
const mockedGetStoredToken = vi.mocked(getStoredToken);

// ── auth ────────────────────────────────────────────────────────────

describe('getAuthStatus', () => {
  beforeEach(() => {
    mockedGetStoredUser.mockReset();
    mockedGetStoredToken.mockReset();
  });

  it('returns loggedIn:false when no user is stored', () => {
    mockedGetStoredUser.mockReturnValue(undefined);
    expect(getAuthStatus()).toEqual({
      loggedIn: false,
      user: null,
      tokenExpiresAt: null,
    });
  });

  it('returns loggedIn:false when user id is "pending"', () => {
    mockedGetStoredUser.mockReturnValue({
      id: 'pending',
      firstName: '',
      lastName: '',
      email: '',
      zone: 'US',
    });
    expect(getAuthStatus().loggedIn).toBe(false);
  });

  it('returns loggedIn:true with user + token expiry when fully authed', () => {
    mockedGetStoredUser.mockReturnValue({
      id: 'abc123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      zone: 'US',
    });
    mockedGetStoredToken.mockReturnValue({
      accessToken: 'tok-xyz',
      idToken: 'id-xyz',
      refreshToken: 'ref-xyz',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    const result = getAuthStatus();
    expect(result.loggedIn).toBe(true);
    expect(result.user).toEqual({
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      zone: 'US',
    });
    expect(result.tokenExpiresAt).toBe('2099-01-01T00:00:00.000Z');
  });
});

describe('getAuthToken', () => {
  beforeEach(() => {
    mockedGetStoredUser.mockReset();
    mockedGetStoredToken.mockReset();
  });

  it('returns nulls when not logged in', () => {
    mockedGetStoredUser.mockReturnValue(undefined);
    expect(getAuthToken()).toEqual({
      token: null,
      expiresAt: null,
      zone: null,
    });
  });

  it('returns the access token and zone when authed', () => {
    mockedGetStoredUser.mockReturnValue({
      id: 'abc',
      firstName: 'A',
      lastName: 'B',
      email: 'a@b',
      zone: 'EU',
    });
    mockedGetStoredToken.mockReturnValue({
      accessToken: 'secret-token',
      idToken: 'id',
      refreshToken: 'ref',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    expect(getAuthToken()).toEqual({
      token: 'secret-token',
      expiresAt: '2099-01-01T00:00:00.000Z',
      zone: 'EU',
    });
  });

  it('returns zone but null token when user stored but no token', () => {
    mockedGetStoredUser.mockReturnValue({
      id: 'abc',
      firstName: 'A',
      lastName: 'B',
      email: 'a@b',
      zone: 'US',
    });
    mockedGetStoredToken.mockReturnValue(undefined);
    expect(getAuthToken()).toEqual({
      token: null,
      expiresAt: null,
      zone: 'US',
    });
  });
});

// ── detect / status ────────────────────────────────────────────────

describe('runDetect + runStatus', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-ops-test-'));
    mockedGetStoredUser.mockReset();
    mockedGetStoredToken.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runDetect returns integration:null and confidence:none for an empty dir', async () => {
    const result = await runDetect(tmpDir);
    expect(result.integration).toBeNull();
    expect(result.confidence).toBe('none');
    expect(Array.isArray(result.signals)).toBe(true);
  });

  it('runDetect returns js-node for a plain Node.js project', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'x', main: 'index.js' }),
    );
    const result = await runDetect(tmpDir);
    expect(result.integration).toBe('javascript_node');
    expect(result.confidence).toBe('detected');
    expect(result.frameworkName).toBeTruthy();
  });

  it('runStatus composes detect + amplitude-installed + api-key + auth into one object', async () => {
    mockedGetStoredUser.mockReturnValue(undefined);
    const result = await runStatus(tmpDir);
    expect(result.installDir).toBe(tmpDir);
    expect(result.framework).toBeDefined();
    expect(result.amplitudeInstalled).toBeDefined();
    expect(result.apiKey).toBeDefined();
    expect(result.auth).toEqual({ loggedIn: false, email: null, zone: null });
  });
});
