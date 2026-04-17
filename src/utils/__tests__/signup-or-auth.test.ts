import { describe, it, expect, vi, beforeEach } from 'vitest';
import { performSignupOrAuth } from '../signup-or-auth';

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

  it('returns null when flag is off', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');

    const result = await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(performDirectSignup).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('returns null when flag is on but email is missing', async () => {
    const { isFlagEnabled } = await import('../../lib/feature-flags.js');
    vi.mocked(isFlagEnabled).mockReturnValue(true);
    const { performDirectSignup } = await import('../direct-signup.js');

    const result = await performSignupOrAuth({
      email: null,
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(performDirectSignup).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('returns null when flag is on but fullName is missing', async () => {
    const { isFlagEnabled } = await import('../../lib/feature-flags.js');
    vi.mocked(isFlagEnabled).mockReturnValue(true);
    const { performDirectSignup } = await import('../direct-signup.js');

    const result = await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: null,
      zone: 'us',
    });

    expect(performDirectSignup).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('returns null when direct signup returns requires_redirect', async () => {
    const { isFlagEnabled } = await import('../../lib/feature-flags.js');
    vi.mocked(isFlagEnabled).mockReturnValue(true);
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'requires_redirect',
    });

    const result = await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(performDirectSignup).toHaveBeenCalledOnce();
    expect(result).toBeNull();
  });

  it('returns null when direct signup returns error', async () => {
    const { isFlagEnabled } = await import('../../lib/feature-flags.js');
    vi.mocked(isFlagEnabled).mockReturnValue(true);
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'error',
      message: 'boom',
    });

    const result = await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(result).toBeNull();
  });

  it('returns tokens on success without calling OAuth', async () => {
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
    const { storeToken } = await import('../ampli-settings.js');

    const result = await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(result).not.toBeNull();
    expect(result).toMatchObject({ accessToken: 'direct-access' });
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

    const result = await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(storeToken).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pending' }),
      expect.anything(),
    );
    expect(result).toMatchObject({ accessToken: 'direct-access' });
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
