/**
 * Regression tests for the silent OAuth refresh path.
 *
 * The auth bug this guards against:
 *   1. Wizard starts with an expired access token + a stored idToken.
 *   2. `tryRefreshToken` exchanges the refresh token for a fresh access
 *      token. Amplitude's response includes a fresh `id_token` too.
 *   3. Pre-fix: the helper extracted only `access_token` and
 *      `refresh_token`, so callers kept reusing the *expired* idToken
 *      for downstream Data API calls (`fetchAmplitudeUser`).
 *   4. The Data API rejected the stale idToken, the wizard fell into
 *      the `auth_required: no_stored_credentials` branch, and emitted
 *      a misleading "not signed in" message even though the user had
 *      just authenticated successfully.
 *
 * The fix rotates `idToken` alongside `accessToken` and
 * `refreshToken`. These tests pin the contract so it stays rotated.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tryRefreshToken } from '../token-refresh.js';

describe('tryRefreshToken', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    // Default: every test must explicitly mock fetch — fail loudly if
    // not, so a missed mock never silently hits real Amplitude.
    global.fetch = vi.fn(() => {
      throw new Error('fetch was not mocked for this test');
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns null when token is still valid (no refresh needed)', async () => {
    const result = await tryRefreshToken({
      accessToken: 'a',
      refreshToken: 'r',
      // 1 hour out — well past the 5-minute buffer
      expiresAt: Date.now() + 3600 * 1000,
    });
    expect(result).toBeNull();
  });

  it('returns null when no refresh token is stored', async () => {
    const result = await tryRefreshToken({
      accessToken: 'a',
      // expired
      expiresAt: Date.now() - 1000,
    });
    expect(result).toBeNull();
  });

  it('rotates the idToken when the server issues a new one', async () => {
    // Server returns a fresh access_token, refresh_token, AND id_token.
    // Without the fix the helper would have dropped id_token on the
    // floor — see file header for why that breaks the next API call.
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: 'new-access',
            id_token: 'new-id',
            refresh_token: 'new-refresh',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ) as typeof fetch;

    const result = await tryRefreshToken({
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: Date.now() - 1000,
    });

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      accessToken: 'new-access',
      idToken: 'new-id',
      refreshToken: 'new-refresh',
    });
  });

  it('returns idToken=undefined when the server omits id_token (so callers fall back to the existing one)', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: 'new-access',
            refresh_token: 'new-refresh',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ) as typeof fetch;

    const result = await tryRefreshToken({
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: Date.now() - 1000,
    });

    expect(result).not.toBeNull();
    expect(result?.accessToken).toBe('new-access');
    // Explicitly undefined — credential-resolution.ts checks for truthy
    // before applying, so an undefined here means "keep the old idToken".
    expect(result?.idToken).toBeUndefined();
  });
});
