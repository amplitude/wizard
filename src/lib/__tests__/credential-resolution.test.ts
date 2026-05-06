import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveCiOAuthTokenFromEnv,
  resolveCredentials,
} from '../credential-resolution';
import { buildSession } from '../wizard-session';
import type { StoredUser, StoredOAuthToken } from '../../utils/ampli-settings';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../utils/ampli-settings.js', () => ({
  getStoredUser: vi.fn(),
  getStoredToken: vi.fn(),
  storeToken: vi.fn(),
}));

vi.mock('../ampli-config.js', () => ({
  readAmpliConfig: vi.fn(() => ({ ok: false })),
}));

vi.mock('../../utils/get-api-key.js', () => ({
  getAPIKey: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('../../utils/urls.js', () => ({
  getHostFromRegion: vi.fn((zone: string) => `https://${zone}.amplitude.com`),
}));

vi.mock('../../utils/debug.js', () => ({
  logToFile: vi.fn(),
}));

vi.mock('../../utils/api-key-store.js', () => ({
  persistApiKey: vi.fn(),
  readApiKeyWithSource: vi.fn(() => null),
}));

vi.mock('../utils/token-refresh.js', () => ({
  tryRefreshToken: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('../../utils/token-refresh.js', () => ({
  tryRefreshToken: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('../api.js', () => ({
  fetchAmplitudeUser: vi.fn(),
  extractAppId: vi.fn(() => 0),
}));

vi.mock('../../utils/analytics.js', () => ({
  analytics: {
    setDistinctId: vi.fn(),
    identifyUser: vi.fn(),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePendingUser(zone = 'us'): StoredUser {
  return {
    id: 'pending',
    email: '',
    firstName: '',
    lastName: '',
    zone: zone as StoredUser['zone'],
  };
}

function makeRealUser(zone = 'us'): StoredUser {
  return {
    id: 'user-123',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    zone: zone as StoredUser['zone'],
  };
}

function makeToken(): StoredOAuthToken {
  return {
    accessToken: 'access-token-abc',
    idToken: 'id-token-xyz',
    refreshToken: 'refresh-token-def',
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('resolveCredentials — zone resolution', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('falls back to pending user zone when no real user or project zone exists', async () => {
    const { getStoredUser, getStoredToken } = await import(
      '../../utils/ampli-settings.js'
    );
    const { fetchAmplitudeUser } = await import('../api.js');

    vi.mocked(getStoredUser).mockReturnValue(makePendingUser('us'));
    vi.mocked(getStoredToken).mockReturnValue(makeToken());
    vi.mocked(fetchAmplitudeUser).mockResolvedValue({
      email: 'test@example.com',
      orgs: [
        {
          id: 'org-1',
          name: 'Test Org',
          projects: [
            {
              id: 'ws-1',
              name: 'Test WS',
              environments: [
                {
                  name: 'Production',
                  rank: 0,
                  app: { id: 'app-1', apiKey: 'api-key-prod' },
                },
              ],
            },
          ],
        },
      ],
    });

    const session = buildSession({});
    await resolveCredentials(session, { requireOrgId: false });

    // session.region is no longer mutated by resolveCredentials (see
    // zone-resolution invariant). Observe that the pending-user zone was
    // honored via the credentials host instead.
    expect(session.credentials?.host).toBe('https://us.amplitude.com');
  });

  it('real user zone wins over pending user zone', async () => {
    const { getStoredUser, getStoredToken } = await import(
      '../../utils/ampli-settings.js'
    );
    const { fetchAmplitudeUser } = await import('../api.js');

    // getStoredUser returns the real user (pending is only a fallback when
    // getStoredUser returns the pending entry — real wins in getStoredUser itself)
    vi.mocked(getStoredUser).mockReturnValue(makeRealUser('eu'));
    vi.mocked(getStoredToken).mockReturnValue(makeToken());
    vi.mocked(fetchAmplitudeUser).mockResolvedValue({
      email: 'test@example.com',
      orgs: [
        {
          id: 'org-1',
          name: 'Test Org',
          projects: [
            {
              id: 'ws-1',
              name: 'Test WS',
              environments: [
                {
                  name: 'Production',
                  rank: 0,
                  app: { id: 'app-1', apiKey: 'api-key-prod' },
                },
              ],
            },
          ],
        },
      ],
    });

    const session = buildSession({});
    await resolveCredentials(session, { requireOrgId: false });

    // See note above — assert the zone via credentials host.
    expect(session.credentials?.host).toBe('https://eu.amplitude.com');
  });

  it('returns no credentials when no user is stored', async () => {
    const { getStoredUser } = await import('../../utils/ampli-settings.js');

    vi.mocked(getStoredUser).mockReturnValue(undefined);

    const session = buildSession({});
    await resolveCredentials(session, { requireOrgId: false });

    // No zone resolved → region stays null, no credentials
    expect(session.region).toBeNull();
    expect(session.credentials).toBeNull();
  });
});

describe('resolveCredentials — silent token refresh', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('persists the rotated id_token from tryRefreshToken so subsequent API calls use the fresh token', async () => {
    // Regression: tryRefreshToken used to discard the id_token from the
    // refresh response and only persist the access token. Subsequent
    // fetchAmplitudeUser calls then 401'd on a stale id_token, the catch
    // block fell through to apiKeyNotice, no credentials were set, and
    // bin.ts emitted the misleading `auth_required: no_stored_credentials`.
    // This test locks down that the rotated id_token reaches storeToken
    // and is used by the API call that follows.
    const { getStoredUser, getStoredToken, storeToken } = await import(
      '../../utils/ampli-settings.js'
    );
    const { tryRefreshToken } = await import('../../utils/token-refresh.js');
    const { fetchAmplitudeUser } = await import('../api.js');

    vi.mocked(getStoredUser).mockReturnValue(makeRealUser('us'));
    vi.mocked(getStoredToken).mockReturnValue({
      ...makeToken(),
      // Already-expired stored token forces a refresh attempt.
      expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
    });
    vi.mocked(tryRefreshToken).mockResolvedValueOnce({
      accessToken: 'rotated-access-token',
      idToken: 'rotated-id-token',
      refreshToken: 'rotated-refresh-token',
      expiresAt: Date.now() + 3600 * 1000,
    });
    vi.mocked(fetchAmplitudeUser).mockResolvedValue({
      email: 'test@example.com',
      orgs: [
        {
          id: 'org-1',
          name: 'Test Org',
          projects: [
            {
              id: 'ws-1',
              name: 'Test WS',
              environments: [
                {
                  name: 'Production',
                  rank: 0,
                  app: { id: 'app-1', apiKey: 'api-key-prod' },
                },
              ],
            },
          ],
        },
      ],
    });

    const session = buildSession({});
    await resolveCredentials(session, { requireOrgId: false });

    // storeToken received the rotated id_token in its payload.
    expect(storeToken).toHaveBeenCalled();
    const storedPayload = vi.mocked(storeToken).mock.calls[0][1];
    expect(storedPayload.idToken).toBe('rotated-id-token');
    expect(storedPayload.accessToken).toBe('rotated-access-token');
    expect(storedPayload.refreshToken).toBe('rotated-refresh-token');

    // fetchAmplitudeUser was called with the rotated id_token, not the stale one.
    expect(vi.mocked(fetchAmplitudeUser).mock.calls[0][0]).toBe(
      'rotated-id-token',
    );

    // Credentials were resolved end-to-end.
    expect(session.credentials?.idToken).toBe('rotated-id-token');
    expect(session.credentials?.projectApiKey).toBe('api-key-prod');
  });

  it('still works when tryRefreshToken returns access+refresh but no idToken (older server)', async () => {
    // Older Hydra/Ory deployments don't include id_token in the refresh
    // response. The code path must not crash and must fall back to the
    // stored idToken instead of clobbering it with undefined.
    const { getStoredUser, getStoredToken, storeToken } = await import(
      '../../utils/ampli-settings.js'
    );
    const { tryRefreshToken } = await import('../../utils/token-refresh.js');
    const { fetchAmplitudeUser } = await import('../api.js');

    vi.mocked(getStoredUser).mockReturnValue(makeRealUser('us'));
    vi.mocked(getStoredToken).mockReturnValue({
      ...makeToken(),
      idToken: 'original-id-token',
      expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
    });
    vi.mocked(tryRefreshToken).mockResolvedValueOnce({
      accessToken: 'rotated-access-token',
      // idToken intentionally absent
      expiresAt: Date.now() + 3600 * 1000,
    });
    vi.mocked(fetchAmplitudeUser).mockResolvedValue({
      email: 'test@example.com',
      orgs: [
        {
          id: 'org-1',
          name: 'Test Org',
          projects: [
            {
              id: 'ws-1',
              name: 'Test WS',
              environments: [
                {
                  name: 'Production',
                  rank: 0,
                  app: { id: 'app-1', apiKey: 'api-key-prod' },
                },
              ],
            },
          ],
        },
      ],
    });

    const session = buildSession({});
    await resolveCredentials(session, { requireOrgId: false });

    // storeToken's payload preserves the original idToken when none was rotated.
    const storedPayload = vi.mocked(storeToken).mock.calls[0][1];
    expect(storedPayload.idToken).toBe('original-id-token');

    // fetchAmplitudeUser used the still-valid original idToken.
    expect(vi.mocked(fetchAmplitudeUser).mock.calls[0][0]).toBe(
      'original-id-token',
    );
  });
});

// ── CI env-var auth path (FINAL_NEW_MIGRATION_PLAN.md §7.5) ────────────────
//
// `WIZARD_OAUTH_TOKEN` + `WIZARD_EXPIRES_AT` + `WIZARD_ZONE` are the org-secret
// env vars that let the eval / bench harness hit the wizard gateway without
// running an interactive OAuth flow. The credential resolver MUST:
//   - prefer the env path over the OAuth file when both are set
//   - throw loudly when the env token is past its expiry (no silent refresh)
//   - throw when WIZARD_EXPIRES_AT is missing or unparseable

describe('resolveCiOAuthTokenFromEnv — env-var precedence', () => {
  const originalToken = process.env.WIZARD_OAUTH_TOKEN;
  const originalExpiry = process.env.WIZARD_EXPIRES_AT;

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.WIZARD_OAUTH_TOKEN;
    } else {
      process.env.WIZARD_OAUTH_TOKEN = originalToken;
    }
    if (originalExpiry === undefined) {
      delete process.env.WIZARD_EXPIRES_AT;
    } else {
      process.env.WIZARD_EXPIRES_AT = originalExpiry;
    }
  });

  it('returns null when WIZARD_OAUTH_TOKEN is unset', () => {
    delete process.env.WIZARD_OAUTH_TOKEN;
    delete process.env.WIZARD_EXPIRES_AT;
    expect(resolveCiOAuthTokenFromEnv()).toBeNull();
  });

  it('returns null when WIZARD_OAUTH_TOKEN is empty / whitespace', () => {
    process.env.WIZARD_OAUTH_TOKEN = '';
    expect(resolveCiOAuthTokenFromEnv()).toBeNull();
    process.env.WIZARD_OAUTH_TOKEN = '   ';
    expect(resolveCiOAuthTokenFromEnv()).toBeNull();
  });

  it('parses ISO 8601 expiry and returns the token', () => {
    process.env.WIZARD_OAUTH_TOKEN = 'ci-org-secret-token';
    const futureIso = new Date(Date.now() + 3600 * 1000).toISOString();
    process.env.WIZARD_EXPIRES_AT = futureIso;
    const result = resolveCiOAuthTokenFromEnv();
    expect(result?.accessToken).toBe('ci-org-secret-token');
    expect(result?.expiresAtMs).toBe(Date.parse(futureIso));
  });

  it('parses unix-seconds expiry and returns the token', () => {
    process.env.WIZARD_OAUTH_TOKEN = 'ci-org-secret-token';
    const futureSeconds = Math.floor(Date.now() / 1000) + 3600;
    process.env.WIZARD_EXPIRES_AT = String(futureSeconds);
    const result = resolveCiOAuthTokenFromEnv();
    expect(result?.accessToken).toBe('ci-org-secret-token');
    expect(result?.expiresAtMs).toBe(futureSeconds * 1000);
  });

  it('throws when WIZARD_EXPIRES_AT is past — does NOT silent-refresh', () => {
    process.env.WIZARD_OAUTH_TOKEN = 'ci-org-secret-token';
    process.env.WIZARD_EXPIRES_AT = new Date(
      Date.now() - 60 * 1000,
    ).toISOString();
    expect(() => resolveCiOAuthTokenFromEnv()).toThrow(/expired/i);
    expect(() => resolveCiOAuthTokenFromEnv()).toThrow(
      /rotate WIZARD_OAUTH_TOKEN/i,
    );
  });

  it('throws when WIZARD_EXPIRES_AT is missing entirely', () => {
    process.env.WIZARD_OAUTH_TOKEN = 'ci-org-secret-token';
    delete process.env.WIZARD_EXPIRES_AT;
    expect(() => resolveCiOAuthTokenFromEnv()).toThrow(
      /missing or unparseable/i,
    );
  });

  it('throws when WIZARD_EXPIRES_AT is unparseable garbage', () => {
    process.env.WIZARD_OAUTH_TOKEN = 'ci-org-secret-token';
    process.env.WIZARD_EXPIRES_AT = 'not-a-real-timestamp';
    expect(() => resolveCiOAuthTokenFromEnv()).toThrow(
      /missing or unparseable/i,
    );
  });
});

describe('resolveCredentials — WIZARD_OAUTH_TOKEN priority over OAuth file', () => {
  const originalToken = process.env.WIZARD_OAUTH_TOKEN;
  const originalExpiry = process.env.WIZARD_EXPIRES_AT;
  const originalZone = process.env.WIZARD_ZONE;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.WIZARD_OAUTH_TOKEN;
    else process.env.WIZARD_OAUTH_TOKEN = originalToken;
    if (originalExpiry === undefined) delete process.env.WIZARD_EXPIRES_AT;
    else process.env.WIZARD_EXPIRES_AT = originalExpiry;
    if (originalZone === undefined) delete process.env.WIZARD_ZONE;
    else process.env.WIZARD_ZONE = originalZone;
  });

  it('uses WIZARD_OAUTH_TOKEN as the access token, ignoring the OAuth file', async () => {
    // Stored OAuth file has a different token. The env path must win.
    const { getStoredUser, getStoredToken } = await import(
      '../../utils/ampli-settings.js'
    );
    vi.mocked(getStoredUser).mockReturnValue(makeRealUser('us'));
    vi.mocked(getStoredToken).mockReturnValue({
      ...makeToken(),
      accessToken: 'oauth-file-token-should-be-ignored',
    });

    process.env.WIZARD_OAUTH_TOKEN = 'env-bearer-token';
    process.env.WIZARD_EXPIRES_AT = new Date(
      Date.now() + 3600 * 1000,
    ).toISOString();

    const session = buildSession({});
    await resolveCredentials(session, { requireOrgId: false });

    expect(session.credentials?.accessToken).toBe('env-bearer-token');
    // No idToken from env path; downstream consumers know to skip
    // idToken-dependent fetches.
    expect(session.credentials?.idToken).toBeUndefined();
  });

  it('throws (does not silent-refresh) when env token is expired', async () => {
    const { getStoredUser, getStoredToken } = await import(
      '../../utils/ampli-settings.js'
    );
    vi.mocked(getStoredUser).mockReturnValue(makeRealUser('us'));
    vi.mocked(getStoredToken).mockReturnValue(makeToken());

    process.env.WIZARD_OAUTH_TOKEN = 'env-bearer-token';
    process.env.WIZARD_EXPIRES_AT = new Date(
      Date.now() - 60 * 1000,
    ).toISOString();

    const session = buildSession({});
    await expect(
      resolveCredentials(session, { requireOrgId: false }),
    ).rejects.toThrow(/expired|rotate WIZARD_OAUTH_TOKEN/i);
  });

  it('honors WIZARD_ZONE when populating credentials.host', async () => {
    process.env.WIZARD_OAUTH_TOKEN = 'env-bearer-token';
    process.env.WIZARD_EXPIRES_AT = new Date(
      Date.now() + 3600 * 1000,
    ).toISOString();
    process.env.WIZARD_ZONE = 'eu';

    const session = buildSession({});
    await resolveCredentials(session, { requireOrgId: false });

    // The mocked getHostFromRegion returns `https://${zone}.amplitude.com`.
    expect(session.credentials?.host).toBe('https://eu.amplitude.com');
  });
});
