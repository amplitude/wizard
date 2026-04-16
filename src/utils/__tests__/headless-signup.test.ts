import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');
vi.mock('../debug', () => ({ logToFile: vi.fn() }));

const mockedAxios = vi.mocked(axios, true);

describe('performHeadlessSignup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function getModule() {
    return import('../headless-signup.js');
  }

  it('constructs the correct US URL', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { type: 'oauth', oauth: { code: 'test-code' } },
    });
    const { performHeadlessSignup } = await getModule();

    await performHeadlessSignup({
      email: 'test@example.com',
      fullName: 'Test User',
      zone: 'us',
    });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://app.amplitude.com/t/headless/provisioning/link-or-create-account',
      expect.objectContaining({ email: 'test@example.com' }),
      expect.objectContaining({ timeout: 15_000 }),
    );
  });

  it('constructs the correct EU URL', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { type: 'oauth', oauth: { code: 'test-code' } },
    });
    const { performHeadlessSignup } = await getModule();

    await performHeadlessSignup({
      email: 'eu@example.com',
      fullName: 'EU User',
      zone: 'eu',
    });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://app.eu.amplitude.com/t/headless/provisioning/link-or-create-account',
      expect.objectContaining({ email: 'eu@example.com' }),
      expect.objectContaining({ timeout: 15_000 }),
    );
  });

  it('sends correct OAuth params in request body', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { type: 'oauth', oauth: { code: 'test-code' } },
    });
    const { performHeadlessSignup } = await getModule();

    await performHeadlessSignup({
      email: 'test@example.com',
      fullName: 'Test User',
      zone: 'us',
    });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        email: 'test@example.com',
        full_name: 'Test User',
        scopes: ['openid', 'offline'],
        state: expect.any(String),
        client_id: expect.any(String),
        redirect_uri: expect.stringContaining('localhost'),
      }),
      expect.objectContaining({ timeout: 15_000 }),
    );
  });

  it('handles oauth response (new user)', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { type: 'oauth', oauth: { code: 'auth-code-123' } },
    });
    const { performHeadlessSignup } = await getModule();

    const result = await performHeadlessSignup({
      email: 'new@example.com',
      fullName: 'New User',
      zone: 'us',
    });

    expect(result).toEqual({
      type: 'oauth',
      code: 'auth-code-123',
      state: expect.any(String),
    });
  });

  it('handles requires_auth response (existing user)', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        type: 'requires_auth',
        requires_auth: {
          type: 'redirect',
          redirect: { url: 'https://auth.amplitude.com/oauth2/auth?...' },
        },
      },
    });
    const { performHeadlessSignup } = await getModule();

    const result = await performHeadlessSignup({
      email: 'existing@example.com',
      fullName: 'Existing User',
      zone: 'us',
    });

    expect(result).toEqual({
      type: 'requires_auth',
      redirectUrl: 'https://auth.amplitude.com/oauth2/auth?...',
    });
  });

  it('handles needs_information response', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        type: 'needs_information',
        needs_information: {
          schema: {
            type: 'object',
            properties: { first_name: { type: 'string' } },
            required: ['first_name'],
          },
        },
      },
    });
    const { performHeadlessSignup } = await getModule();

    const result = await performHeadlessSignup({
      email: 'new@example.com',
      fullName: '',
      zone: 'us',
    });

    expect(result).toEqual({
      type: 'needs_information',
      schema: expect.objectContaining({ type: 'object' }),
    });
  });

  it('handles error response', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        type: 'error',
        error: { code: 'invalid_parameters', message: 'Invalid email' },
      },
    });
    const { performHeadlessSignup } = await getModule();

    const result = await performHeadlessSignup({
      email: 'bad',
      fullName: 'User',
      zone: 'us',
    });

    expect(result).toEqual({
      type: 'error',
      code: 'invalid_parameters',
      message: 'Invalid email',
    });
  });

  it('handles network errors gracefully', async () => {
    mockedAxios.post.mockRejectedValue(new Error('Network Error'));
    const { performHeadlessSignup } = await getModule();

    const result = await performHeadlessSignup({
      email: 'test@example.com',
      fullName: 'Test User',
      zone: 'us',
    });

    expect(result).toEqual({
      type: 'error',
      code: 'network_error',
      message: 'Network Error',
    });
  });

  it('handles HTTP error with structured body', async () => {
    const err = new Error('Request failed') as Error & {
      response?: { data: unknown };
    };
    err.response = {
      data: {
        type: 'error',
        error: { code: 'rate_limited', message: 'Too many requests' },
      },
    };
    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.post.mockRejectedValue(err);
    const { performHeadlessSignup } = await getModule();

    const result = await performHeadlessSignup({
      email: 'test@example.com',
      fullName: 'Test User',
      zone: 'us',
    });

    expect(result).toEqual({
      type: 'error',
      code: 'rate_limited',
      message: 'Too many requests',
    });
  });
});

describe('exchangeHeadlessCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exchanges code without code_verifier', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: 'access-123',
        id_token: 'id-123',
        refresh_token: 'refresh-123',
        token_type: 'Bearer',
        expires_in: 3600,
      },
    });
    const { exchangeHeadlessCode } = await import('../headless-signup.js');

    const result = await exchangeHeadlessCode('auth-code', 'us');

    expect(result).toEqual({
      access_token: 'access-123',
      id_token: 'id-123',
      refresh_token: 'refresh-123',
      token_type: 'Bearer',
      expires_in: 3600,
    });

    // Verify no code_verifier in the request
    const postBody = mockedAxios.post.mock.calls[0][1] as string;
    expect(postBody).not.toContain('code_verifier');
    expect(postBody).toContain('grant_type=authorization_code');
    expect(postBody).toContain('code=auth-code');
  });

  it('posts to the correct token endpoint for US zone', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: 'a',
        id_token: 'i',
        refresh_token: 'r',
        token_type: 'Bearer',
        expires_in: 3600,
      },
    });
    const { exchangeHeadlessCode } = await import('../headless-signup.js');

    await exchangeHeadlessCode('code', 'us');

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://auth.amplitude.com/oauth2/token',
      expect.any(String),
      expect.any(Object),
    );
  });

  it('posts to the correct token endpoint for EU zone', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        access_token: 'a',
        id_token: 'i',
        refresh_token: 'r',
        token_type: 'Bearer',
        expires_in: 3600,
      },
    });
    const { exchangeHeadlessCode } = await import('../headless-signup.js');

    await exchangeHeadlessCode('code', 'eu');

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://auth.eu.amplitude.com/oauth2/token',
      expect.any(String),
      expect.any(Object),
    );
  });
});
