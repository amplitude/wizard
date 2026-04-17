import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/feature-flags.js', () => ({
  FLAG_DIRECT_SIGNUP: 'wizard-direct-signup',
  isFlagEnabled: vi.fn((key: string) => key === 'wizard-direct-signup'),
  initFeatureFlags: vi.fn(async () => {}),
}));

vi.mock('../../../utils/direct-signup.js', () => ({
  performDirectSignup: vi.fn(),
}));

vi.mock('../../../lib/api.js', () => ({
  fetchAmplitudeUser: vi.fn(),
}));

vi.mock('../../../utils/ampli-settings.js', () => ({
  storeToken: vi.fn(),
}));

describe('TUI mode + direct signup integration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('on success, direct signup populates a real StoredUser and returns tokens', async () => {
    const { isFlagEnabled } = await import('../../../lib/feature-flags.js');
    vi.mocked(isFlagEnabled).mockImplementation(
      (key: string) => key === 'wizard-direct-signup',
    );
    const { performDirectSignup } = await import(
      '../../../utils/direct-signup.js'
    );
    const { fetchAmplitudeUser } = await import('../../../lib/api.js');
    const { storeToken } = await import('../../../utils/ampli-settings.js');

    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'success',
      tokens: {
        accessToken: 'tui-access',
        idToken: 'tui-id',
        refreshToken: 'tui-refresh',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        zone: 'us',
      },
    });
    vi.mocked(fetchAmplitudeUser).mockResolvedValue({
      id: 'user-99',
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      zone: 'us',
      orgs: [],
    });

    const { performSignupOrAuth } = await import(
      '../../../utils/signup-or-auth.js'
    );

    const result = await performSignupOrAuth({
      email: 'grace@example.com',
      fullName: 'Grace Hopper',
      zone: 'us',
    });

    expect(performDirectSignup).toHaveBeenCalledOnce();
    expect(fetchAmplitudeUser).toHaveBeenCalledOnce();
    expect(storeToken).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'user-99',
        email: 'grace@example.com',
        zone: 'us',
      }),
      expect.anything(),
    );
    expect(result).not.toBeNull();
    expect(result!.accessToken).toBe('tui-access');
  });

  it('when flag is off, the wrapper returns null without calling direct signup', async () => {
    const { isFlagEnabled } = await import('../../../lib/feature-flags.js');
    vi.mocked(isFlagEnabled).mockReturnValue(false);
    const { performDirectSignup } = await import(
      '../../../utils/direct-signup.js'
    );

    const { performSignupOrAuth } = await import(
      '../../../utils/signup-or-auth.js'
    );
    const result = await performSignupOrAuth({
      email: 'grace@example.com',
      fullName: 'Grace Hopper',
      zone: 'us',
    });

    expect(performDirectSignup).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('when direct signup returns requires_redirect, returns null', async () => {
    const { isFlagEnabled } = await import('../../../lib/feature-flags.js');
    vi.mocked(isFlagEnabled).mockImplementation(
      (key: string) => key === 'wizard-direct-signup',
    );
    const { performDirectSignup } = await import(
      '../../../utils/direct-signup.js'
    );
    vi.mocked(performDirectSignup).mockResolvedValue({
      kind: 'requires_redirect',
    });

    const { performSignupOrAuth } = await import(
      '../../../utils/signup-or-auth.js'
    );
    const result = await performSignupOrAuth({
      email: 'grace@example.com',
      fullName: 'Grace Hopper',
      zone: 'us',
    });

    expect(performDirectSignup).toHaveBeenCalledOnce();
    expect(result).toBeNull();
  });
});
