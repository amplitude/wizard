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
  extractProjectId: vi.fn(() => 0),
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
          workspaces: [
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

    expect(session.region).toBe('us');
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
          workspaces: [
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

    expect(session.region).toBe('eu');
  });

  it('returns early without touching region when no user is stored', async () => {
    const { getStoredUser } = await import('../../utils/ampli-settings.js');

    vi.mocked(getStoredUser).mockReturnValue(undefined);

    const session = buildSession({});
    await resolveCredentials(session, { requireOrgId: false });

    // No zone resolved → region stays null, no credentials
    expect(session.region).toBeNull();
    expect(session.credentials).toBeNull();
  });
});
