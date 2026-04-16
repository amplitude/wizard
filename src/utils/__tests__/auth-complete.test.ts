import { describe, it, expect, vi } from 'vitest';
import { completeAuth } from '../auth-complete.js';

function makeDeps(overrides: Record<string, unknown> = {}) {
  const session = { userEmail: null as string | null };
  const analytics = { setDistinctId: vi.fn(), identifyUser: vi.fn() };
  const performAmplitudeAuth = vi.fn();
  const fetchAmplitudeUser = vi.fn();
  const storeToken = vi.fn();
  return {
    session,
    analytics,
    performAmplitudeAuth,
    fetchAmplitudeUser,
    storeToken,
    auth: {
      idToken: 'id-1',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      zone: 'us' as const,
    },
    ...overrides,
  };
}

const USER_INFO = {
  id: 'u1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  orgs: [],
};

describe('completeAuth', () => {
  it('happy path: stores token, sets distinct id, updates session', async () => {
    const deps = makeDeps();
    (deps.fetchAmplitudeUser as any).mockResolvedValue(USER_INFO);

    await completeAuth(deps);

    expect(deps.storeToken).toHaveBeenCalledOnce();
    expect(deps.session.userEmail).toBe('ada@example.com');
    expect(deps.analytics.setDistinctId).toHaveBeenCalledWith(
      'ada@example.com',
    );
  });

  it('re-throws instead of browser fallback when allowBrowserRecovery=false', async () => {
    const deps = makeDeps();
    (deps.fetchAmplitudeUser as any).mockRejectedValueOnce(
      new Error('boom'),
    );

    await expect(
      completeAuth({ ...deps, allowBrowserRecovery: false }),
    ).rejects.toThrow(/Failed to fetch Amplitude user info/);

    // Must NOT have fallen back to browser auth
    expect(deps.performAmplitudeAuth).not.toHaveBeenCalled();
    expect(deps.storeToken).not.toHaveBeenCalled();
  });

  it('default (allowBrowserRecovery=true) falls back to browser OAuth on fetch failure', async () => {
    const deps = makeDeps();
    (deps.fetchAmplitudeUser as any)
      .mockRejectedValueOnce(new Error('expired'))
      .mockResolvedValueOnce(USER_INFO);
    (deps.performAmplitudeAuth as any).mockResolvedValue({
      idToken: 'fresh-id',
      accessToken: 'fresh-access',
      refreshToken: 'fresh-refresh',
      zone: 'us',
    });

    await completeAuth(deps);

    expect(deps.performAmplitudeAuth).toHaveBeenCalledWith({
      zone: 'us',
      forceFresh: true,
    });
    expect(deps.storeToken).toHaveBeenCalledOnce();
    expect(deps.session.userEmail).toBe('ada@example.com');
  });
});
