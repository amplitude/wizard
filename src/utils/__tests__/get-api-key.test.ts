import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api-key-store.js');
vi.mock('../../lib/api.js');

import { readApiKeyWithSource } from '../api-key-store.js';
import { fetchAmplitudeUser } from '../../lib/api.js';
import { getAPIKey } from '../get-api-key.js';

const mockReadApiKeyWithSource = vi.mocked(readApiKeyWithSource);
const mockFetchAmplitudeUser = vi.mocked(fetchAmplitudeUser);

beforeEach(() => {
  vi.resetAllMocks();
});

const BASE_PARAMS = {
  installDir: '/project',
  idToken: 'id-token',
  zone: 'us' as const,
};

describe('getAPIKey', () => {
  it('returns the key from local storage without hitting the backend', async () => {
    mockReadApiKeyWithSource.mockReturnValue({
      key: 'local-api-key',
      source: 'keychain',
    });

    const result = await getAPIKey(BASE_PARAMS);

    expect(result).toBe('local-api-key');
    expect(mockFetchAmplitudeUser).not.toHaveBeenCalled();
  });

  it('fetches from the backend when local storage is empty', async () => {
    mockReadApiKeyWithSource.mockReturnValue(null);
    mockFetchAmplitudeUser.mockResolvedValue({
      id: 'u1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      orgs: [
        {
          id: 'org1',
          name: 'Acme',
          workspaces: [
            {
              id: 'ws1',
              name: 'Main',
              environments: [
                {
                  name: 'Production',
                  rank: 1,
                  app: { id: 'app1', apiKey: 'prod-key' },
                },
              ],
            },
          ],
        },
      ],
    });

    const result = await getAPIKey(BASE_PARAMS);

    expect(result).toBe('prod-key');
    expect(mockFetchAmplitudeUser).toHaveBeenCalledWith('id-token', 'us');
  });

  it('picks the lowest-ranked environment when multiple environments exist', async () => {
    mockReadApiKeyWithSource.mockReturnValue(null);
    mockFetchAmplitudeUser.mockResolvedValue({
      id: 'u1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      orgs: [
        {
          id: 'org1',
          name: 'Acme',
          workspaces: [
            {
              id: 'ws1',
              name: 'Main',
              environments: [
                {
                  name: 'Staging',
                  rank: 2,
                  app: { id: 'app2', apiKey: 'staging-key' },
                },
                {
                  name: 'Production',
                  rank: 1,
                  app: { id: 'app1', apiKey: 'prod-key' },
                },
              ],
            },
          ],
        },
      ],
    });

    const result = await getAPIKey(BASE_PARAMS);
    expect(result).toBe('prod-key');
  });

  it('uses workspaceId to select the correct workspace', async () => {
    mockReadApiKeyWithSource.mockReturnValue(null);
    mockFetchAmplitudeUser.mockResolvedValue({
      id: 'u1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      orgs: [
        {
          id: 'org1',
          name: 'Acme',
          workspaces: [
            {
              id: 'ws-other',
              name: 'Other',
              environments: [
                {
                  name: 'Production',
                  rank: 1,
                  app: { id: 'app-other', apiKey: 'other-key' },
                },
              ],
            },
            {
              id: 'ws-target',
              name: 'Target',
              environments: [
                {
                  name: 'Production',
                  rank: 1,
                  app: { id: 'app-target', apiKey: 'target-key' },
                },
              ],
            },
          ],
        },
      ],
    });

    const result = await getAPIKey({
      ...BASE_PARAMS,
      workspaceId: 'ws-target',
    });
    expect(result).toBe('target-key');
  });

  it('returns null when backend fetch fails', async () => {
    mockReadApiKeyWithSource.mockReturnValue(null);
    mockFetchAmplitudeUser.mockRejectedValue(new Error('network error'));

    const result = await getAPIKey(BASE_PARAMS);
    expect(result).toBeNull();
  });

  it('returns null when backend returns no environments with keys', async () => {
    mockReadApiKeyWithSource.mockReturnValue(null);
    mockFetchAmplitudeUser.mockResolvedValue({
      id: 'u1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      orgs: [
        {
          id: 'org1',
          name: 'Acme',
          workspaces: [
            {
              id: 'ws1',
              name: 'Main',
              environments: [
                {
                  name: 'Production',
                  rank: 1,
                  app: { id: 'app1', apiKey: null },
                },
              ],
            },
          ],
        },
      ],
    });

    const result = await getAPIKey(BASE_PARAMS);
    expect(result).toBeNull();
  });

  it('passes installDir to readApiKeyWithSource', async () => {
    mockReadApiKeyWithSource.mockReturnValue(null);
    mockFetchAmplitudeUser.mockResolvedValue({
      id: 'u1',
      firstName: 'A',
      lastName: 'B',
      email: 'a@b.com',
      orgs: [],
    });

    await getAPIKey({ ...BASE_PARAMS, installDir: '/my/project' });
    expect(mockReadApiKeyWithSource).toHaveBeenCalledWith('/my/project');
  });
});
