/**
 * Tests for `tryRefreshToken` — covers the JWT-exp-driven expiresAt
 * derivation that landed alongside the jwt-exp utility.
 *
 * The old behavior used `expires_in` from the refresh response (24h on
 * Ory) for `expiresAt`. With id_token TTL at 1h, that meant the proactive-
 * refresh trigger would skip a 23-hour window where the id_token had
 * expired but the access_token hadn't — producing 401s mid-API-call.
 *
 * These tests lock in: the rotated id_token's `exp` claim drives the
 * returned `expiresAt`, with `expires_in` as a graceful fallback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tryRefreshToken } from '../token-refresh.js';

vi.mock('../debug.js', () => ({ logToFile: vi.fn() }));
vi.mock('../../lib/observability/index.js', () => ({
  withWizardSpan: vi.fn(async (_a, _b, _c, fn: () => Promise<unknown>) => fn()),
  addBreadcrumb: vi.fn(),
}));

const NOW = 1_700_000_000_000;

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', typ: 'JWT' }),
  ).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fakesig`;
}

function mockFetchOnce(body: Record<string, unknown>): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as unknown as Response);
}

describe('tryRefreshToken', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it('uses the rotated id_token JWT exp for expiresAt, not expires_in', async () => {
    // id_token says exp = NOW + 45 min. expires_in says 24h. The id_token
    // wins because its TTL is the binding constraint for our API calls.
    const idTokenExpSec = Math.floor((NOW + 45 * 60 * 1000) / 1000);
    const idToken = makeJwt({ exp: idTokenExpSec });
    mockFetchOnce({
      access_token: 'new-access-token',
      id_token: idToken,
      refresh_token: 'rotated-refresh-token',
      expires_in: 24 * 60 * 60, // 24h — should be ignored in favor of id_token exp
    });

    const result = await tryRefreshToken(
      {
        accessToken: 'old-access-token',
        refreshToken: 'old-refresh-token',
        // Already expired so refresh fires.
        expiresAt: NOW - 60 * 1000,
      },
      'us',
    );

    expect(result).not.toBeNull();
    expect(result!.idToken).toBe(idToken);
    expect(result!.expiresAt).toBe(idTokenExpSec * 1000);
    // Sanity: the access_token TTL is NOT what was returned.
    expect(result!.expiresAt).toBeLessThan(NOW + 60 * 60 * 1000);
  });

  it('falls back to expires_in when no id_token is returned (older server)', async () => {
    // No id_token in the response — older Hydra/Ory installations.
    mockFetchOnce({
      access_token: 'new-access-token',
      refresh_token: 'rotated-refresh-token',
      expires_in: 30 * 60, // 30 min
    });

    const result = await tryRefreshToken(
      {
        accessToken: 'old-access-token',
        refreshToken: 'old-refresh-token',
        expiresAt: NOW - 60 * 1000,
      },
      'us',
    );

    expect(result).not.toBeNull();
    expect(result!.idToken).toBeUndefined();
    expect(result!.expiresAt).toBe(NOW + 30 * 60 * 1000);
  });

  it('falls back to expires_in when the id_token JWT is malformed', async () => {
    mockFetchOnce({
      access_token: 'new-access-token',
      id_token: 'not.a-valid-jwt',
      refresh_token: 'rotated-refresh-token',
      expires_in: 30 * 60, // 30 min
    });

    const result = await tryRefreshToken(
      {
        accessToken: 'old-access-token',
        refreshToken: 'old-refresh-token',
        expiresAt: NOW - 60 * 1000,
      },
      'us',
    );

    expect(result).not.toBeNull();
    // Malformed JWT → fall back to expires_in.
    expect(result!.expiresAt).toBe(NOW + 30 * 60 * 1000);
  });

  it('returns null when the access_token is still valid (>5 min remaining)', async () => {
    // No fetch should be made. If it were, the test would throw because
    // we didn't stub fetch.
    const result = await tryRefreshToken(
      {
        accessToken: 'still-valid',
        refreshToken: 'still-valid-refresh',
        expiresAt: NOW + 10 * 60 * 1000, // 10 min in the future
      },
      'us',
    );

    expect(result).toBeNull();
  });

  it('returns null when no refresh token is stored', async () => {
    const result = await tryRefreshToken(
      {
        accessToken: 'expired-access',
        // refreshToken intentionally undefined
        expiresAt: NOW - 60 * 1000,
      },
      'us',
    );

    expect(result).toBeNull();
  });
});
