import { vi, describe, it, expect, beforeEach } from 'vitest';
import { resolveCredentials } from '../credential-resolution';
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
