import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  tryResolveCredentialsForCi,
  getOrAskForProjectData,
} from '../setup-utils.js';

vi.mock('../api-key-store.js', () => ({
  readApiKeyWithSource: vi.fn(),
}));

vi.mock('../ampli-settings.js', () => ({
  getStoredUser: vi.fn(),
  getStoredToken: vi.fn(),
  storeToken: vi.fn(),
}));

vi.mock('../../lib/ampli-config.js', () => ({
  readAmpliConfig: vi.fn(),
  ampliConfigExists: vi.fn(() => true),
}));

vi.mock('../get-api-key.js', () => ({
  getAPIKey: vi.fn(),
}));

vi.mock('../wizard-abort.js', () => ({
  wizardAbort: vi.fn(() => Promise.reject(new Error('wizard-abort'))),
}));

vi.mock('../ui', () => ({
  getUI: vi.fn(() => ({
    intro: vi.fn(),
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), step: vi.fn() },
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
    setLoginUrl: vi.fn(),
    setCredentials: vi.fn(),
    cancel: vi.fn(),
  })),
}));

vi.mock('../../telemetry', () => ({
  traceStep: vi.fn((_step: string, fn: () => unknown) => fn()),
}));

vi.mock('../oauth', () => ({
  performAmplitudeAuth: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  fetchAmplitudeUser: vi.fn(),
}));

import { readApiKeyWithSource } from '../api-key-store.js';
import { getStoredUser, getStoredToken } from '../ampli-settings.js';
import { readAmpliConfig } from '../../lib/ampli-config.js';
import { getAPIKey } from '../get-api-key.js';
import { wizardAbort } from '../wizard-abort.js';
import { performAmplitudeAuth } from '../oauth.js';

describe('tryResolveCredentialsForCi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readAmpliConfig).mockReturnValue({
      ok: false,
      error: 'not_found',
    });
    vi.mocked(getStoredUser).mockReturnValue(undefined);
    vi.mocked(getStoredToken).mockReturnValue(undefined);
    vi.mocked(getAPIKey).mockResolvedValue(null);
  });

  it('returns project-local key when readApiKeyWithSource finds one', async () => {
    vi.mocked(readApiKeyWithSource).mockReturnValue({
      key: 'local-key',
      source: 'env',
    });

    const r = await tryResolveCredentialsForCi('/tmp/proj');

    expect(r).toEqual({
      host: expect.any(String),
      projectApiKey: 'local-key',
      accessToken: 'local-key',
      cloudRegion: 'us',
    });
    expect(getAPIKey).not.toHaveBeenCalled();
  });

  it('uses getAPIKey when OAuth token and backend key are available', async () => {
    vi.mocked(readApiKeyWithSource).mockReturnValue(null);
    vi.mocked(getStoredUser).mockReturnValue({
      id: 'u1',
      firstName: 'A',
      lastName: 'B',
      email: 'a@b.c',
      zone: 'us',
    });
    vi.mocked(getStoredToken).mockReturnValue({
      accessToken: 'at',
      idToken: 'idtok',
      refreshToken: 'rt',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    vi.mocked(readAmpliConfig).mockReturnValue({
      ok: true,
      config: { ProjectId: 'proj-1', Zone: 'us' },
    });
    vi.mocked(getAPIKey).mockResolvedValue('fetched-key');

    const r = await tryResolveCredentialsForCi('/tmp/proj');

    expect(r?.projectApiKey).toBe('fetched-key');
    expect(r?.accessToken).toBe('at');
    expect(getAPIKey).toHaveBeenCalledWith({
      installDir: '/tmp/proj',
      idToken: 'idtok',
      zone: 'us',
      projectId: 'proj-1',
    });
  });

  it('returns null when nothing resolves', async () => {
    vi.mocked(readApiKeyWithSource).mockReturnValue(null);

    const r = await tryResolveCredentialsForCi('/tmp/proj');

    expect(r).toBeNull();
  });
});

describe('getOrAskForProjectData — CI mode without explicit api key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readApiKeyWithSource).mockReturnValue(null);
    vi.mocked(readAmpliConfig).mockReturnValue({
      ok: false,
      error: 'not_found',
    });
    vi.mocked(getStoredUser).mockReturnValue(undefined);
    vi.mocked(getStoredToken).mockReturnValue(undefined);
    vi.mocked(getAPIKey).mockResolvedValue(null);
  });

  it('aborts when CI cannot resolve credentials', async () => {
    await expect(
      getOrAskForProjectData({
        ci: true,
        signup: false,
        installDir: '/tmp/ci-proj',
      }),
    ).rejects.toThrow('wizard-abort');

    expect(wizardAbort).toHaveBeenCalled();
    expect(performAmplitudeAuth).not.toHaveBeenCalled();
  });

  it('returns resolved credentials without OAuth when tryResolve succeeds', async () => {
    vi.mocked(readApiKeyWithSource).mockReturnValue({
      key: 'k',
      source: 'env',
    });

    const result = await getOrAskForProjectData({
      ci: true,
      signup: false,
      installDir: '/tmp/ci-proj',
    });

    expect(result.projectApiKey).toBe('k');
    expect(performAmplitudeAuth).not.toHaveBeenCalled();
  });
});
