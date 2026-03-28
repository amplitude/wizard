import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { fetchProjectCredentials } from '../api.js';

vi.mock('axios');
vi.mock('../../utils/analytics.js', () => ({
  analytics: {
    captureException: vi.fn(),
    setDistinctId: vi.fn(),
    setTag: vi.fn(),
    wizardCapture: vi.fn(),
  },
}));

const mockedAxios = vi.mocked(axios, true);

describe('fetchProjectCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns credentials on success', async () => {
    const mockData = {
      apiKey: 'abc123',
      appName: 'My App',
      appId: '456',
      orgId: '789',
    };
    mockedAxios.get.mockResolvedValue({ data: mockData });

    const result = await fetchProjectCredentials(
      'oauth-token',
      'https://core.amplitude.com',
      '456',
    );

    expect(result).toEqual(mockData);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://core.amplitude.com/agentic/api/project-credentials/456',
      {
        headers: {
          'x-amplitude-auth': 'oauth-token',
          'User-Agent': expect.any(String),
        },
      },
    );
  });

  it('returns null on 403 (permission denied)', async () => {
    const error = new axios.AxiosError(
      'Forbidden',
      '403',
      undefined,
      undefined,
      {
        status: 403,
      } as any,
    );
    mockedAxios.get.mockRejectedValue(error);
    mockedAxios.isAxiosError.mockReturnValue(true);

    const result = await fetchProjectCredentials(
      'oauth-token',
      'https://core.amplitude.com',
      '456',
    );

    expect(result).toBeNull();
  });

  it('returns null on 404 (app not found)', async () => {
    const error = new axios.AxiosError(
      'Not Found',
      '404',
      undefined,
      undefined,
      {
        status: 404,
      } as any,
    );
    mockedAxios.get.mockRejectedValue(error);
    mockedAxios.isAxiosError.mockReturnValue(true);

    const result = await fetchProjectCredentials(
      'oauth-token',
      'https://core.amplitude.com',
      '999',
    );

    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    mockedAxios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    mockedAxios.isAxiosError.mockReturnValue(false);

    const result = await fetchProjectCredentials(
      'oauth-token',
      'https://core.amplitude.com',
      '456',
    );

    expect(result).toBeNull();
  });
});
