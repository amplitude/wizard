import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  performSignupOrAuth,
  AGENTIC_SIGNUP_ATTEMPTED_EVENT,
} from '../signup-or-auth';

vi.mock('../direct-signup.js', () => ({
  performDirectSignup: vi.fn(),
}));
vi.mock('../ampli-settings.js', () => ({
  storeToken: vi.fn(),
}));
vi.mock('../../lib/api.js', () => ({
  fetchAmplitudeUser: vi.fn(),
}));
vi.mock('../analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
  },
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

  it('returns null when email is missing', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    const { analytics } = await import('../analytics');

    const result = await performSignupOrAuth({
      email: null,
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(performDirectSignup).not.toHaveBeenCalled();
    expect(result).toBeNull();
    expect(analytics.wizardCapture).not.toHaveBeenCalledWith(
      AGENTIC_SIGNUP_ATTEMPTED_EVENT,
      expect.anything(),
    );
  });

  it('returns null when fullName is missing', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    const { analytics } = await import('../analytics');

    const result = await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: null,
      zone: 'us',
    });

    expect(performDirectSignup).not.toHaveBeenCalled();
    expect(result).toBeNull();
    expect(analytics.wizardCapture).not.toHaveBeenCalledWith(
      AGENTIC_SIGNUP_ATTEMPTED_EVENT,
      expect.anything(),
    );
  });

  it('returns null when direct signup returns requires_redirect', async () => {
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

  it('emits agentic signup attempted with status=requires_redirect on redirect path', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'requires_redirect',
    });
    const { analytics } = await import('../analytics');

    await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      AGENTIC_SIGNUP_ATTEMPTED_EVENT,
      { status: 'requires_redirect', zone: 'us' },
    );
  });

  it('returns null when direct signup returns error', async () => {
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

  it('emits agentic signup attempted with status=signup_error on error kind', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'error',
      message: 'boom',
    });
    const { analytics } = await import('../analytics');

    await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      AGENTIC_SIGNUP_ATTEMPTED_EVENT,
      { status: 'signup_error', zone: 'us' },
    );
  });

  it('emits agentic signup attempted with status=signup_error when performDirectSignup throws', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockRejectedValue(new Error('network'));
    const { analytics } = await import('../analytics');

    await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      AGENTIC_SIGNUP_ATTEMPTED_EVENT,
      { status: 'signup_error', zone: 'us' },
    );
  });

  it('returns tokens on success without calling OAuth', async () => {
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

  it('emits agentic signup attempted with status=success on the success path', async () => {
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
    vi.mocked(fetchAmplitudeUser).mockResolvedValue({
      id: 'user-123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      orgs: provisionedOrgs,
    });
    const { analytics } = await import('../analytics');

    await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      AGENTIC_SIGNUP_ATTEMPTED_EVENT,
      {
        status: 'success',
        zone: 'us',
        'has env with api key': true,
        'user fetch retry count': 0,
      },
    );
  });

  it('persists StoredUser with real user id from fetchAmplitudeUser', async () => {
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
    vi.useFakeTimers();
    try {
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

      const pending = performSignupOrAuth({
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
      expect(result).toMatchObject({ accessToken: 'direct-access' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits agentic signup attempted with status=user_fetch_failed when fetch retries exhaust', async () => {
    vi.useFakeTimers();
    try {
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
      vi.mocked(fetchAmplitudeUser).mockRejectedValue(new Error('network'));
      const { analytics } = await import('../analytics');

      const pending = performSignupOrAuth({
        email: 'ada@example.com',
        fullName: 'Ada Lovelace',
        zone: 'us',
      });
      await vi.runAllTimersAsync();
      await pending;

      expect(analytics.wizardCapture).toHaveBeenCalledWith(
        AGENTIC_SIGNUP_ATTEMPTED_EVENT,
        {
          status: 'user_fetch_failed',
          zone: 'us',
          'user fetch retry count': 3,
        },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries fetchAmplitudeUser when the new account has no env with an API key yet', async () => {
    vi.useFakeTimers();
    try {
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
