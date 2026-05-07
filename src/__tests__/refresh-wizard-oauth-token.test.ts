/**
 * Unit tests for `scripts/refresh-wizard-oauth-token.mjs`.
 *
 * Imports the ESM script directly (vitest happily loads it because the
 * file extension is .mjs). We exercise the exported `refreshOAuthToken`
 * helper so we don't have to spawn a child Node process for each case.
 */

process.env.AMPLITUDE_WIZARD_SKIP_BOOTSTRAP = '1';

import { describe, it, expect } from 'vitest';

// @ts-expect-error — .mjs import path; vitest resolves it via Node's ESM loader.
import { refreshOAuthToken } from '../../scripts/refresh-wizard-oauth-token.mjs';

function mockFetch(response: {
  ok: boolean;
  status?: number;
  statusText?: string;
  body?: unknown;
}) {
  return async (_url: string, _init: { signal?: AbortSignal }) => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    statusText: response.statusText ?? '',
    json: async () => response.body ?? {},
    text: async () =>
      typeof response.body === 'string'
        ? response.body
        : JSON.stringify(response.body ?? {}),
  });
}

describe('refreshOAuthToken', () => {
  it('returns rotated credentials on a successful refresh', async () => {
    const fetchImpl = mockFetch({
      ok: true,
      body: {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      },
    });
    const result = await refreshOAuthToken({
      refreshToken: 'old-refresh',
      zone: 'us',
      fetchImpl,
      now: 1_700_000_000_000,
    });
    expect(result).toEqual({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      // 1_700_000_000_000 + 3600 * 1000 = 1_700_003_600_000 → 2023-11-14T22:33:20.000Z
      expiresAt: new Date(1_700_003_600_000).toISOString(),
    });
  });

  it('echoes the input refresh token when Hydra does not rotate it', async () => {
    const fetchImpl = mockFetch({
      ok: true,
      body: { access_token: 'a', expires_in: 60 },
    });
    const result = await refreshOAuthToken({
      refreshToken: 'unchanged',
      zone: 'us',
      fetchImpl,
      now: 0,
    });
    expect(result.refreshToken).toBe('unchanged');
  });

  it('targets the EU host when zone=eu', async () => {
    let calledUrl = '';
    const fetchImpl = async (url: string) => {
      calledUrl = url;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ access_token: 'x', expires_in: 60 }),
        text: async () => '',
      };
    };
    await refreshOAuthToken({
      refreshToken: 'r',
      zone: 'eu',
      fetchImpl,
      now: 0,
    });
    expect(calledUrl).toContain('auth.eu.amplitude.com');
  });

  it('throws when refresh token is missing', async () => {
    await expect(
      refreshOAuthToken({ zone: 'us', fetchImpl: mockFetch({ ok: true }) }),
    ).rejects.toThrow(/WIZARD_REFRESH_TOKEN is required/);
  });

  it('throws on an unrecognized zone', async () => {
    await expect(
      refreshOAuthToken({
        refreshToken: 'r',
        // @ts-expect-error — exercising defensive runtime check
        zone: 'apac',
        fetchImpl: mockFetch({ ok: true }),
      }),
    ).rejects.toThrow(/WIZARD_ZONE must be 'us' or 'eu'/);
  });

  it('throws when Hydra returns a non-2xx status', async () => {
    const fetchImpl = mockFetch({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      body: 'invalid_grant',
    });
    await expect(
      refreshOAuthToken({ refreshToken: 'r', zone: 'us', fetchImpl }),
    ).rejects.toThrow(/Hydra .* returned 401/);
  });

  it('throws when Hydra returns an unexpected response shape', async () => {
    const fetchImpl = mockFetch({
      ok: true,
      body: { access_token: 'x' /* missing expires_in */ },
    });
    await expect(
      refreshOAuthToken({ refreshToken: 'r', zone: 'us', fetchImpl }),
    ).rejects.toThrow(/Unexpected response shape/);
  });
});
