import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  performSignupOrAuth,
  AGENTIC_SIGNUP_ATTEMPTED_EVENT,
} from '../signup-or-auth';

vi.mock('../direct-signup.js', () => ({
  performDirectSignup: vi.fn(),
}));
vi.mock('../ampli-settings.js', () => ({
  replaceStoredUser: vi.fn(),
}));
vi.mock('../clear-stale-project-state.js', () => ({
  clearStaleProjectState: vi.fn(),
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
    projects: [
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

  it('returns error when email is missing', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    const { analytics } = await import('../analytics');

    const result = await performSignupOrAuth({
      email: null,
      fullName: 'Ada Lovelace',
      zone: 'us',
      installDir: '/tmp/wizard-test',
    });

    expect(performDirectSignup).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: 'error' });
    expect(analytics.wizardCapture).not.toHaveBeenCalledWith(
      AGENTIC_SIGNUP_ATTEMPTED_EVENT,
      expect.anything(),
    );
  });

  it('returns requires_redirect when direct signup returns requires_redirect', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'requires_redirect',
    });

    const result = await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
      installDir: '/tmp/wizard-test',
    });

    expect(performDirectSignup).toHaveBeenCalledOnce();
    expect(result).toEqual({ kind: 'requires_redirect' });
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
      installDir: '/tmp/wizard-test',
    });

    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      AGENTIC_SIGNUP_ATTEMPTED_EVENT,
      { status: 'requires_redirect', zone: 'us' },
    );
  });

  it('returns error when direct signup returns error', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'error',
      message: 'boom',
    });

    const result = await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
      installDir: '/tmp/wizard-test',
    });

    expect(result).toEqual({ kind: 'error' });
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
      installDir: '/tmp/wizard-test',
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
      installDir: '/tmp/wizard-test',
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
    const { replaceStoredUser } = await import('../ampli-settings.js');

    const result = await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
      installDir: '/tmp/wizard-test',
    });

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.accessToken).toBe('direct-access');
      expect(result.dashboardUrl).toBeNull();
    }
    expect(replaceStoredUser).toHaveBeenCalledOnce();
  });

  it('forwards dashboardUrl from performDirectSignup on success', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    const magic = 'https://app.amplitude.com/magic?x=1';
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'success',
      tokens: {
        accessToken: 'a',
        idToken: 'i',
        refreshToken: 'r',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        zone: 'us',
      },
      dashboardUrl: magic,
    });
    const { fetchAmplitudeUser } = await import('../../lib/api.js');
    vi.mocked(fetchAmplitudeUser).mockResolvedValue({
      id: 'user-123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      orgs: provisionedOrgs,
    });

    const result = await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
      installDir: '/tmp/wizard-test',
    });

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.dashboardUrl).toBe(magic);
    }
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
      installDir: '/tmp/wizard-test',
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
    const { replaceStoredUser } = await import('../ampli-settings.js');

    await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
      installDir: '/tmp/wizard-test',
    });

    expect(replaceStoredUser).toHaveBeenCalledWith(
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

  it('wipes pre-existing per-project state before persisting the new account on success', async () => {
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
    const { replaceStoredUser } = await import('../ampli-settings.js');
    const { clearStaleProjectState } = await import(
      '../clear-stale-project-state.js'
    );

    await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
      installDir: '/tmp/wizard-test-fresh',
    });

    expect(clearStaleProjectState).toHaveBeenCalledWith(
      '/tmp/wizard-test-fresh',
    );
    // Wipe must run BEFORE replaceStoredUser so that a partial-state crash
    // between them fails closed (no key) rather than open (old key).
    const wipeOrder = vi.mocked(clearStaleProjectState).mock
      .invocationCallOrder[0];
    const persistOrder =
      vi.mocked(replaceStoredUser).mock.invocationCallOrder[0];
    expect(wipeOrder).toBeLessThan(persistOrder);
  });

  it('does NOT wipe project state on requires_redirect', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'requires_redirect',
    });
    const { clearStaleProjectState } = await import(
      '../clear-stale-project-state.js'
    );

    await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
      installDir: '/tmp/wizard-test',
    });

    expect(clearStaleProjectState).not.toHaveBeenCalled();
  });

  it('does NOT wipe project state on needs_information', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'needs_information',
      requiredFields: ['full_name'],
    });
    const { clearStaleProjectState } = await import(
      '../clear-stale-project-state.js'
    );

    await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: null,
      zone: 'us',
      installDir: '/tmp/wizard-test',
    });

    expect(clearStaleProjectState).not.toHaveBeenCalled();
  });

  it('does NOT wipe project state on error kind', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'error',
      message: 'boom',
    });
    const { clearStaleProjectState } = await import(
      '../clear-stale-project-state.js'
    );

    await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
      installDir: '/tmp/wizard-test',
    });

    expect(clearStaleProjectState).not.toHaveBeenCalled();
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
    const { replaceStoredUser } = await import('../ampli-settings.js');

    await performSignupOrAuth({
      email: 'ada@example.com',
      fullName: '  Ada   Lovelace  ',
      zone: 'us',
      installDir: '/tmp/wizard-test',
    });

    expect(replaceStoredUser).toHaveBeenCalledWith(
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
      const { replaceStoredUser } = await import('../ampli-settings.js');

      const pending = performSignupOrAuth({
        email: 'ada@example.com',
        fullName: 'Ada Lovelace',
        zone: 'us',
        installDir: '/tmp/wizard-test',
      });
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(replaceStoredUser).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'pending' }),
        expect.anything(),
      );
      expect(result.kind).toBe('success');
      if (result.kind === 'success') {
        expect(result.accessToken).toBe('direct-access');
      }
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
        installDir: '/tmp/wizard-test',
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
              projects: [{ id: 'ws-1', name: 'Default', environments: [] }],
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
        installDir: '/tmp/wizard-test',
      });
      await vi.runAllTimersAsync();
      await pending;

      expect(fetchAmplitudeUser).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('performSignupOrAuth — needs_information arm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns { kind: "needs_information", requiredFields } and tracks telemetry', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValueOnce({
      kind: 'needs_information',
      requiredFields: ['full_name'],
    });
    const { analytics } = await import('../analytics');

    const result = await performSignupOrAuth({
      email: 'new@acme.com',
      fullName: null,
      zone: 'us',
      installDir: '/tmp/wizard-test',
    });

    expect(result).toEqual({
      kind: 'needs_information',
      requiredFields: ['full_name'],
    });
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      AGENTIC_SIGNUP_ATTEMPTED_EVENT,
      expect.objectContaining({ status: 'needs_information', zone: 'us' }),
    );
  });
});

describe('performSignupOrAuth — missing fullName no longer short-circuits', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes null fullName through to performDirectSignup', async () => {
    const { performDirectSignup } = await import('../direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValueOnce({
      kind: 'needs_information',
      requiredFields: ['full_name'],
    });

    await performSignupOrAuth({
      email: 'new@acme.com',
      fullName: null,
      zone: 'us',
      installDir: '/tmp/wizard-test',
    });

    expect(performDirectSignup).toHaveBeenCalledWith(
      {
        email: 'new@acme.com',
        fullName: null,
        zone: 'us',
      },
      expect.anything(),
    );
  });
});
