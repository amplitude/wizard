import { describe, it, expect, vi, beforeEach } from 'vitest';
import { performSignupOrAuth } from '../signup-or-auth';

vi.mock('../oauth.js', () => ({
  performAmplitudeAuth: vi.fn(async () => ({
    idToken: 'oauth-id',
    accessToken: 'oauth-access',
    refreshToken: 'oauth-refresh',
    zone: 'us' as const,
  })),
}));
vi.mock('../direct-signup.js', () => ({
  performDirectSignup: vi.fn(),
}));
vi.mock('../../lib/feature-flags.js', () => ({
  FLAG_DIRECT_SIGNUP: 'wizard-direct-signup',
  isFlagEnabled: vi.fn(() => false),
}));
vi.mock('../ampli-settings.js', () => ({
  storeToken: vi.fn(),
}));
vi.mock('../../lib/api.js', () => ({
  fetchAmplitudeUser: vi.fn(),
}));

// Minimal provisioned-account shape: one org / workspace / env with an
// apiKey. Having this is the signal that backend provisioning finished,
// so fetchUserWithProvisioningRetry returns on the first call (no delays).
const provisionedOrgs = [
  {
    id: 'org-1',
    name: 'Org',
    workspaces: [
      {
        id: 'ws-1',
        name: 'Default',
        environments: [
          { name: 'Production', rank: 0, app: { id: 'p1', apiKey: 'key-1' } },
        ],
      },
    ],
  },
];

describe('performSignupOrAuth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls OAuth directly when flag is off', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    const { performAmplitudeAuth } = await import('../oauth.js');

    const result = await performSignupOrAuth({
      signup: true,
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(performDirectSignup).not.toHaveBeenCalled();
    expect(performAmplitudeAuth).toHaveBeenCalledOnce();
    expect(result.accessToken).toBe('oauth-access');
  });

  it('falls back to OAuth when flag is on but email is missing', async () => {
    const { isFlagEnabled } = await import('../../lib/feature-flags.js');
    vi.mocked(isFlagEnabled).mockReturnValue(true);
    const { performDirectSignup } = await import('../direct-signup.js');
    const { performAmplitudeAuth } = await import('../oauth.js');

    await performSignupOrAuth({
      signup: true,
      email: null,
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(performDirectSignup).not.toHaveBeenCalled();
    expect(performAmplitudeAuth).toHaveBeenCalledOnce();
  });

  it('falls back to OAuth when flag is on but fullName is missing', async () => {
    const { isFlagEnabled } = await import('../../lib/feature-flags.js');
    vi.mocked(isFlagEnabled).mockReturnValue(true);
    const { performDirectSignup } = await import('../direct-signup.js');
    const { performAmplitudeAuth } = await import('../oauth.js');

    await performSignupOrAuth({
      signup: true,
      email: 'ada@example.com',
      fullName: null,
      zone: 'us',
    });

    expect(performDirectSignup).not.toHaveBeenCalled();
    expect(performAmplitudeAuth).toHaveBeenCalledOnce();
  });

  it('falls back to OAuth when --signup is not set', async () => {
    const { isFlagEnabled } = await import('../../lib/feature-flags.js');
    vi.mocked(isFlagEnabled).mockReturnValue(true);
    const { performDirectSignup } = await import('../direct-signup.js');
    const { performAmplitudeAuth } = await import('../oauth.js');

    await performSignupOrAuth({
      signup: false,
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(performDirectSignup).not.toHaveBeenCalled();
    expect(performAmplitudeAuth).toHaveBeenCalledOnce();
  });

  it('falls back to OAuth when direct signup returns requires_redirect', async () => {
    const { isFlagEnabled } = await import('../../lib/feature-flags.js');
    vi.mocked(isFlagEnabled).mockReturnValue(true);
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'requires_redirect',
    });
    const { performAmplitudeAuth } = await import('../oauth.js');

    await performSignupOrAuth({
      signup: true,
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(performDirectSignup).toHaveBeenCalledOnce();
    expect(performAmplitudeAuth).toHaveBeenCalledOnce();
  });

  it('falls back to OAuth when direct signup errors', async () => {
    const { isFlagEnabled } = await import('../../lib/feature-flags.js');
    vi.mocked(isFlagEnabled).mockReturnValue(true);
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'error',
      message: 'boom',
    });
    const { performAmplitudeAuth } = await import('../oauth.js');

    await performSignupOrAuth({
      signup: true,
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(performAmplitudeAuth).toHaveBeenCalledOnce();
  });

  it('returns direct-signup tokens on success without calling OAuth', async () => {
    const { isFlagEnabled } = await import('../../lib/feature-flags.js');
    vi.mocked(isFlagEnabled).mockReturnValue(true);
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'success',
      tokens: {
        accessToken: 'direct-access',
        idToken: 'direct-id',
        refreshToken: 'direct-refresh',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        zone: 'us',
      },
    });
    const { fetchAmplitudeUser } = await import('../../lib/api.js');
    vi.mocked(fetchAmplitudeUser).mockResolvedValue({
      id: 'user-123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      orgs: provisionedOrgs,
    });
    const { performAmplitudeAuth } = await import('../oauth.js');
    const { storeToken } = await import('../ampli-settings.js');

    const result = await performSignupOrAuth({
      signup: true,
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(performAmplitudeAuth).not.toHaveBeenCalled();
    expect(result.accessToken).toBe('direct-access');
    expect(storeToken).toHaveBeenCalledOnce();
  });

  it('persists StoredUser with real user id from fetchAmplitudeUser', async () => {
    const { isFlagEnabled } = await import('../../lib/feature-flags.js');
    vi.mocked(isFlagEnabled).mockReturnValue(true);
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'success',
      tokens: {
        accessToken: 'a',
        idToken: 'i',
        refreshToken: 'r',
        expiresAt: new Date().toISOString(),
        zone: 'us',
      },
    });
    const { fetchAmplitudeUser } = await import('../../lib/api.js');
    vi.mocked(fetchAmplitudeUser).mockResolvedValue({
      id: 'user-123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      orgs: provisionedOrgs,
    });
    const { storeToken } = await import('../ampli-settings.js');

    await performSignupOrAuth({
      signup: true,
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(storeToken).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'user-123',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        zone: 'us',
      }),
      expect.anything(),
    );
  });

  it('normalizes extra whitespace in fullName before splitting', async () => {
    const { isFlagEnabled } = await import('../../lib/feature-flags.js');
    vi.mocked(isFlagEnabled).mockReturnValue(true);
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'success',
      tokens: {
        accessToken: 'a',
        idToken: 'i',
        refreshToken: 'r',
        expiresAt: new Date().toISOString(),
        zone: 'us',
      },
    });
    const { fetchAmplitudeUser } = await import('../../lib/api.js');
    vi.mocked(fetchAmplitudeUser).mockResolvedValue({
      id: 'user-123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      orgs: provisionedOrgs,
    });
    const { storeToken } = await import('../ampli-settings.js');

    await performSignupOrAuth({
      signup: true,
      email: 'ada@example.com',
      fullName: '  Ada   Lovelace  ',
      zone: 'us',
    });

    expect(storeToken).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'user-123',
        firstName: 'Ada',
        lastName: 'Lovelace',
      }),
      expect.anything(),
    );
  });

  it('falls back to pending sentinel when fetchAmplitudeUser fails after direct-signup success', async () => {
    vi.useFakeTimers();
    try {
      const { isFlagEnabled } = await import('../../lib/feature-flags.js');
      vi.mocked(isFlagEnabled).mockReturnValue(true);
      const { performDirectSignup } = await import('../direct-signup.js');
      vi.mocked(performDirectSignup).mockResolvedValue({
        kind: 'success',
        tokens: {
          accessToken: 'direct-access',
          idToken: 'direct-id',
          refreshToken: 'direct-refresh',
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          zone: 'us',
        },
      });
      const { fetchAmplitudeUser } = await import('../../lib/api.js');
      vi.mocked(fetchAmplitudeUser).mockRejectedValue(new Error('network'));
      const { storeToken } = await import('../ampli-settings.js');
      const { performAmplitudeAuth } = await import('../oauth.js');

      const pending = performSignupOrAuth({
        signup: true,
        email: 'ada@example.com',
        fullName: 'Ada Lovelace',
        zone: 'us',
      });
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(storeToken).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'pending' }),
        expect.anything(),
      );
      expect(result.accessToken).toBe('direct-access');
      expect(performAmplitudeAuth).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries fetchAmplitudeUser when the new account has no env with an API key yet', async () => {
    vi.useFakeTimers();
    try {
      const { isFlagEnabled } = await import('../../lib/feature-flags.js');
      vi.mocked(isFlagEnabled).mockReturnValue(true);
      const { performDirectSignup } = await import('../direct-signup.js');
      vi.mocked(performDirectSignup).mockResolvedValue({
        kind: 'success',
        tokens: {
          accessToken: 'a',
          idToken: 'i',
          refreshToken: 'r',
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          zone: 'us',
        },
      });
      const { fetchAmplitudeUser } = await import('../../lib/api.js');
      vi.mocked(fetchAmplitudeUser)
        .mockResolvedValueOnce({
          id: 'u',
          firstName: 'A',
          lastName: 'B',
          email: 'a@b.com',
          orgs: [],
        })
        .mockResolvedValueOnce({
          id: 'u',
          firstName: 'A',
          lastName: 'B',
          email: 'a@b.com',
          orgs: [
            {
              id: 'org-1',
              name: 'Org',
              workspaces: [{ id: 'ws-1', name: 'Default', environments: [] }],
            },
          ],
        })
        .mockResolvedValueOnce({
          id: 'u',
          firstName: 'A',
          lastName: 'B',
          email: 'a@b.com',
          orgs: provisionedOrgs,
        });

      const pending = performSignupOrAuth({
        signup: true,
        email: 'a@b.com',
        fullName: 'A B',
        zone: 'us',
      });
      await vi.runAllTimersAsync();
      await pending;

      expect(fetchAmplitudeUser).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
