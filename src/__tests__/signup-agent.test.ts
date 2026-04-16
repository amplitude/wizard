import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/feature-flags.js', () => ({
  FLAG_DIRECT_SIGNUP: 'wizard-direct-signup',
  isFlagEnabled: vi.fn((key: string) => key === 'wizard-direct-signup'),
  initFeatureFlags: vi.fn(async () => {}),
}));

vi.mock('../utils/direct-signup.js', () => ({
  performDirectSignup: vi.fn(),
}));

vi.mock('../lib/api.js', () => ({
  fetchAmplitudeUser: vi.fn(),
}));

vi.mock('../utils/ampli-settings.js', () => ({
  storeToken: vi.fn(),
}));

vi.mock('../utils/oauth.js', () => ({
  performAmplitudeAuth: vi.fn(async () => ({
    accessToken: 'oauth-access',
    idToken: 'oauth-id',
    refreshToken: 'oauth-refresh',
    zone: 'us' as const,
  })),
}));

describe('agent mode + --signup + direct signup integration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('on success, direct signup populates a real StoredUser and returns tokens without calling OAuth', async () => {
    const { performDirectSignup } = await import('../utils/direct-signup.js');
    const { fetchAmplitudeUser } = await import('../lib/api.js');
    const { storeToken } = await import('../utils/ampli-settings.js');
    const { performAmplitudeAuth } = await import('../utils/oauth.js');

    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'success',
      tokens: {
        accessToken: 'agent-access',
        idToken: 'agent-id',
        refreshToken: 'agent-refresh',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        zone: 'us',
      },
    });
    vi.mocked(fetchAmplitudeUser).mockResolvedValue({
      id: 'user-42',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      zone: 'us',
      orgs: [],
    });

    const { buildSession } = await import('../lib/wizard-session.js');
    const { performSignupOrAuth } = await import('../utils/signup-or-auth.js');

    const session = buildSession({
      signup: true,
      signupEmail: 'ada@example.com',
      signupFullName: 'Ada Lovelace',
    });

    const result = await performSignupOrAuth({
      signup: session.signup,
      email: session.signupEmail,
      fullName: session.signupFullName,
      zone: 'us',
    });

    expect(performDirectSignup).toHaveBeenCalledOnce();
    expect(fetchAmplitudeUser).toHaveBeenCalledOnce();
    expect(storeToken).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'user-42',
        email: 'ada@example.com',
        zone: 'us',
      }),
      expect.anything(),
    );
    expect(performAmplitudeAuth).not.toHaveBeenCalled();
    expect(result.accessToken).toBe('agent-access');
  });

  it('when --signup is not set, the wrapper short-circuits to OAuth (parity)', async () => {
    const { performDirectSignup } = await import('../utils/direct-signup.js');
    const { performAmplitudeAuth } = await import('../utils/oauth.js');

    const { performSignupOrAuth } = await import('../utils/signup-or-auth.js');
    await performSignupOrAuth({
      signup: false,
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(performDirectSignup).not.toHaveBeenCalled();
    expect(performAmplitudeAuth).toHaveBeenCalledOnce();
  });

  it('when direct signup returns requires_redirect, falls back to OAuth', async () => {
    const { performDirectSignup } = await import('../utils/direct-signup.js');
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'requires_redirect',
    });
    const { performAmplitudeAuth } = await import('../utils/oauth.js');

    const { performSignupOrAuth } = await import('../utils/signup-or-auth.js');
    await performSignupOrAuth({
      signup: true,
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(performDirectSignup).toHaveBeenCalledOnce();
    expect(performAmplitudeAuth).toHaveBeenCalledOnce();
  });
});
