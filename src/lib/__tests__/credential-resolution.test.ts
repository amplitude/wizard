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

// ── CI env-var auth path (MIGRATION_PLAN.md §7.5) ────────────────
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

// ── Second-run-after-`git reset --hard` regression ────────────────────
//
// Bug:
//   1. User runs the wizard once → `.amplitude/project-binding.json`
//      written, `~/.amplitude/wizard/credentials.json` populated.
//   2. User runs `git reset --hard` → `.amplitude/project-binding.json`
//      and `.amplitude/events.json` get wiped.
//   3. User reruns the wizard. self-heal correctly clears the orphan API
//      key entry. resolveCredentials silently refreshes the OAuth token,
//      fetches user info, finds 2 environments with API keys for the
//      first project, and "defers" — populates `pendingOrgs` and returns.
//   4. Pre-fix: the void return looked indistinguishable from "credentials
//      ready" to non-TUI callers. The wizard parked at "Detecting your
//      project setup" with no diagnostic, and there was no in-band signal
//      a downstream surface could branch on to route the user to the
//      env picker / emit `auth_required: env_selection_failed`.
//
// Lock-down: in the multi-env defer scenario the resolver MUST
//   - NOT hang (return within a deterministic await),
//   - NOT throw,
//   - return `{ outcome: 'needs_user_choice', kind: 'environment_selection',
//     envsWithKey: 2 }`,
//   - populate `pendingOrgs` + `pendingAuthIdToken` + `pendingAuthAccessToken`
//     so a TUI surface can drive the env picker.
describe('resolveCredentials — second-run after `.amplitude/` wipe', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns needs_user_choice when binding is missing and the project has multiple envs', async () => {
    const { getStoredUser, getStoredToken } = await import(
      '../../utils/ampli-settings.js'
    );
    const { fetchAmplitudeUser } = await import('../api.js');
    const { readApiKeyWithSource } = await import(
      '../../utils/api-key-store.js'
    );

    // Simulate self-heal having already cleared the orphan API key entry
    // for this install dir — this is the precondition that takes us off
    // the "use locally stored API key" fast path and onto the
    // fetch-user-then-defer path.
    vi.mocked(readApiKeyWithSource).mockReturnValue(null);

    // Token refresh succeeded silently — matches the user-reported log
    // line `[token-refresh] silent refresh succeeded`.
    const { tryRefreshToken } = await import('../../utils/token-refresh.js');
    vi.mocked(getStoredUser).mockReturnValue(makeRealUser('us'));
    vi.mocked(getStoredToken).mockReturnValue({
      ...makeToken(),
      expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
    });
    vi.mocked(tryRefreshToken).mockResolvedValueOnce({
      accessToken: 'rotated-access-token',
      idToken: 'rotated-id-token',
      refreshToken: 'rotated-refresh-token',
      expiresAt: Date.now() + 3600 * 1000,
    });

    // Live API returns one project with TWO environments (Production +
    // Development). This is the exact shape the user's report described:
    // `[credential-resolution] 2 environments found — deferring`.
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
                  app: { id: 'app-prod', apiKey: 'api-key-prod' },
                },
                {
                  name: 'Development',
                  rank: 1,
                  app: { id: 'app-dev', apiKey: 'api-key-dev' },
                },
              ],
            },
          ],
        },
      ],
    });

    const session = buildSession({});

    // Prove the call returns within a finite await (no hang).
    const TIMEOUT_MS = 1000;
    const result = await Promise.race([
      resolveCredentials(session, { requireOrgId: false }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`resolveCredentials hung > ${TIMEOUT_MS}ms`)),
          TIMEOUT_MS,
        ),
      ),
    ]);

    // Explicit "needs user choice" outcome — the load-bearing signal.
    // Pre-fix this would have been `undefined` (Promise<void>).
    expect(result).toEqual({
      outcome: 'needs_user_choice',
      kind: 'environment_selection',
      envsWithKey: 2,
    });

    // pendingOrgs + pending tokens populated so the TUI env picker
    // (or the agent-mode `promptEnvironmentSelection` helper) has
    // everything it needs.
    expect(session.pendingOrgs).toHaveLength(1);
    expect(session.pendingOrgs?.[0]?.projects?.[0]?.environments).toHaveLength(
      2,
    );
    expect(session.pendingAuthIdToken).toBe('rotated-id-token');
    expect(session.pendingAuthAccessToken).toBe('rotated-access-token');

    // Credentials remain null — must NOT auto-pick. Auto-picking the
    // first env would silently write to a possibly-wrong project
    // (the very class of bug the `--confirm-app` gate exists to prevent).
    expect(session.credentials).toBeNull();
  });

  it('returns resolved when a stored API key exists (self-heal did not run)', async () => {
    // Sanity sibling: the same scenario without the self-heal step
    // takes the locally-stored-API-key fast path — proves the new
    // result type still surfaces `'resolved'` correctly when the
    // resolver does land credentials.
    const { getStoredUser, getStoredToken } = await import(
      '../../utils/ampli-settings.js'
    );
    const { readApiKeyWithSource } = await import(
      '../../utils/api-key-store.js'
    );

    vi.mocked(getStoredUser).mockReturnValue(makeRealUser('us'));
    vi.mocked(getStoredToken).mockReturnValue(makeToken());
    vi.mocked(readApiKeyWithSource).mockReturnValue({
      key: 'cached-api-key',
      source: 'cache',
    });

    const session = buildSession({});
    const result = await resolveCredentials(session, { requireOrgId: false });

    expect(result.outcome).toBe('resolved');
    expect(session.credentials?.projectApiKey).toBe('cached-api-key');
  });

  it('returns unauthenticated when no stored token exists', async () => {
    const { getStoredUser } = await import('../../utils/ampli-settings.js');
    vi.mocked(getStoredUser).mockReturnValue(undefined);

    const session = buildSession({});
    const result = await resolveCredentials(session, { requireOrgId: false });

    expect(result).toEqual({ outcome: 'unauthenticated' });
    expect(session.credentials).toBeNull();
  });

  it('returns api_key_notice when fetch succeeds but the project has no environments with keys', async () => {
    const { getStoredUser, getStoredToken } = await import(
      '../../utils/ampli-settings.js'
    );
    const { fetchAmplitudeUser } = await import('../api.js');
    const { readApiKeyWithSource } = await import(
      '../../utils/api-key-store.js'
    );

    vi.mocked(readApiKeyWithSource).mockReturnValue(null);
    vi.mocked(getStoredUser).mockReturnValue(makeRealUser('us'));
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
              // No envs with keys — admin-only access scenario.
              environments: [
                { name: 'Production', rank: 0, app: { id: 'app-prod' } },
              ],
            },
          ],
        },
      ],
    });

    const session = buildSession({});
    const result = await resolveCredentials(session, { requireOrgId: false });

    expect(result).toEqual({ outcome: 'api_key_notice' });
    expect(session.apiKeyNotice).toContain('API key');
  });
});
