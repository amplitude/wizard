import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { performDirectSignup } from '../direct-signup';

const PROVISIONING_URL = 'https://app.amplitude.com/t/agentic/signup/v1';
const EU_PROVISIONING_URL = 'https://app.eu.amplitude.com/t/agentic/signup/v1';
const TOKEN_URL = 'https://auth.amplitude.com/oauth2/token';

const VALID_TOKEN_RESPONSE = {
  access_token: 'a',
  id_token: 'i',
  refresh_token: 'r',
  token_type: 'Bearer',
  expires_in: 3600,
};

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const INPUT = {
  email: 'ada@example.com',
  fullName: 'Ada Lovelace',
  zone: 'us' as const,
};

describe('performDirectSignup', () => {
  it('happy path: exchanges oauth code for tokens and returns success', async () => {
    server.use(
      http.post(PROVISIONING_URL, () =>
        HttpResponse.json({ type: 'oauth', oauth: { code: 'auth-code-xyz' } }),
      ),
      http.post(TOKEN_URL, () => HttpResponse.json(VALID_TOKEN_RESPONSE)),
    );

    const result = await performDirectSignup(INPUT);

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.tokens.accessToken).toBe('a');
      expect(result.tokens.idToken).toBe('i');
      expect(result.tokens.refreshToken).toBe('r');
      expect(result.tokens.zone).toBe('us');
      expect(result.tokens.expiresAt).toBeTruthy();
      expect(result.dashboardUrl).toBeNull();
    }
  });

  it('returns dashboardUrl when provisioning includes dashboard_url', async () => {
    const magic =
      'https://app.amplitude.com/login/magic?next=%2Fanalytics%2Fd%2Fx';
    server.use(
      http.post(PROVISIONING_URL, () =>
        HttpResponse.json({
          type: 'oauth',
          oauth: { code: 'auth-code-xyz' },
          dashboard_url: magic,
        }),
      ),
      http.post(TOKEN_URL, () => HttpResponse.json(VALID_TOKEN_RESPONSE)),
    );

    const result = await performDirectSignup(INPUT);

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.dashboardUrl).toBe(magic);
    }
  });

  it('accepts null dashboard_url from provisioning', async () => {
    server.use(
      http.post(PROVISIONING_URL, () =>
        HttpResponse.json({
          type: 'oauth',
          oauth: { code: 'auth-code-xyz' },
          dashboard_url: null,
        }),
      ),
      http.post(TOKEN_URL, () => HttpResponse.json(VALID_TOKEN_RESPONSE)),
    );

    const result = await performDirectSignup(INPUT);

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.dashboardUrl).toBeNull();
    }
  });

  it('returns requires_redirect on requires_auth response', async () => {
    server.use(
      http.post(PROVISIONING_URL, () =>
        HttpResponse.json({
          type: 'requires_auth',
          requires_auth: {
            type: 'redirect',
            redirect: { url: 'https://amplitude.com/login' },
          },
        }),
      ),
    );

    const result = await performDirectSignup(INPUT);

    expect(result.kind).toBe('requires_redirect');
  });

  it('returns error with server message on error response', async () => {
    server.use(
      http.post(PROVISIONING_URL, () =>
        HttpResponse.json({
          type: 'error',
          error: { code: 'invalid_parameters', message: 'Email is invalid' },
        }),
      ),
    );

    const result = await performDirectSignup(INPUT);

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('Email is invalid');
    }
  });

  it('returns error with "Unexpected" message on unrecognized 2xx response shape', async () => {
    server.use(http.post(PROVISIONING_URL, () => HttpResponse.json({})));

    const result = await performDirectSignup(INPUT);

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('Unexpected');
    }
  });

  it('surfaces 429 rate-limit with its HTTP meaning on unrecognized body', async () => {
    server.use(
      http.post(PROVISIONING_URL, () =>
        HttpResponse.json(
          { message: 'rate limited upstream' },
          { status: 429 },
        ),
      ),
    );

    const result = await performDirectSignup(INPUT);

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('429');
      expect(result.message.toLowerCase()).toContain('rate limited');
    }
  });

  it('surfaces non-429 4xx as HTTP client error rather than "Unexpected response"', async () => {
    server.use(
      http.post(PROVISIONING_URL, () =>
        HttpResponse.json({ unknown: 'shape' }, { status: 403 }),
      ),
    );

    const result = await performDirectSignup(INPUT);

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('403');
      expect(result.message).not.toContain('Unexpected');
    }
  });

  it('returns error on network failure at provisioning endpoint', async () => {
    server.use(http.post(PROVISIONING_URL, () => HttpResponse.error()));

    const result = await performDirectSignup(INPUT);

    expect(result.kind).toBe('error');
  });

  it('routes EU requests to app.eu.amplitude.com', async () => {
    let observedUrl = '';
    server.use(
      http.post(EU_PROVISIONING_URL, ({ request }) => {
        observedUrl = request.url;
        return HttpResponse.json({ type: 'oauth', oauth: { code: 'eu-code' } });
      }),
      http.post('https://auth.eu.amplitude.com/oauth2/token', () =>
        HttpResponse.json(VALID_TOKEN_RESPONSE),
      ),
    );

    await performDirectSignup({ ...INPUT, zone: 'eu' });

    expect(observedUrl).toBe(EU_PROVISIONING_URL);
  });

  it('returns error when token exchange fails after successful provisioning', async () => {
    server.use(
      http.post(PROVISIONING_URL, () =>
        HttpResponse.json({ type: 'oauth', oauth: { code: 'auth-code-xyz' } }),
      ),
      http.post(TOKEN_URL, () => HttpResponse.error()),
    );

    const result = await performDirectSignup(INPUT);

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('Token exchange failed');
    }
  });

  it('returns error with parsed OAuth error on 400 token exchange response', async () => {
    server.use(
      http.post(PROVISIONING_URL, () =>
        HttpResponse.json({ type: 'oauth', oauth: { code: 'auth-code-xyz' } }),
      ),
      http.post(TOKEN_URL, () =>
        HttpResponse.json(
          { error: 'invalid_grant', error_description: 'Expired' },
          { status: 400 },
        ),
      ),
    );

    const result = await performDirectSignup(INPUT);

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('invalid_grant');
      expect(result.message).toContain('Expired');
    }
  });

  it('returns error when token exchange 200 body does not match TokenSchema', async () => {
    server.use(
      http.post(PROVISIONING_URL, () =>
        HttpResponse.json({ type: 'oauth', oauth: { code: 'auth-code-xyz' } }),
      ),
      http.post(TOKEN_URL, () => HttpResponse.json({})),
    );

    const result = await performDirectSignup(INPUT);

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('invalid response');
    }
  });

  it('returns error when provisioning returns oauth code with empty string', async () => {
    server.use(
      http.post(PROVISIONING_URL, () =>
        HttpResponse.json({ type: 'oauth', oauth: { code: '' } }),
      ),
    );

    const result = await performDirectSignup(INPUT);

    expect(result.kind).toBe('error');
  });

  it('returns error when expires_in is out of bounds', async () => {
    server.use(
      http.post(PROVISIONING_URL, () =>
        HttpResponse.json({ type: 'oauth', oauth: { code: 'auth-code-xyz' } }),
      ),
      http.post(TOKEN_URL, () =>
        HttpResponse.json({ ...VALID_TOKEN_RESPONSE, expires_in: 0 }),
      ),
    );

    const result = await performDirectSignup(INPUT);

    expect(result.kind).toBe('error');
  });

  it('returns error when expires_in is excessively large', async () => {
    server.use(
      http.post(PROVISIONING_URL, () =>
        HttpResponse.json({ type: 'oauth', oauth: { code: 'auth-code-xyz' } }),
      ),
      http.post(TOKEN_URL, () =>
        HttpResponse.json({
          ...VALID_TOKEN_RESPONSE,
          expires_in: 99_999_999_999,
        }),
      ),
    );

    const result = await performDirectSignup(INPUT);

    expect(result.kind).toBe('error');
  });

  it('honors AMPLITUDE_WIZARD_SIGNUP_URL override', async () => {
    const original = process.env.AMPLITUDE_WIZARD_SIGNUP_URL;
    process.env.AMPLITUDE_WIZARD_SIGNUP_URL =
      'http://localhost:9999/custom-path';
    let observedUrl = '';
    server.use(
      http.post('http://localhost:9999/custom-path', ({ request }) => {
        observedUrl = request.url;
        return HttpResponse.json({
          type: 'requires_auth',
          requires_auth: {
            type: 'redirect',
            redirect: { url: 'https://example.com' },
          },
        });
      }),
    );

    try {
      await performDirectSignup({
        email: 'ada@example.com',
        fullName: 'Ada Lovelace',
        zone: 'us',
      });
      expect(observedUrl).toBe('http://localhost:9999/custom-path');
    } finally {
      if (original === undefined) {
        delete process.env.AMPLITUDE_WIZARD_SIGNUP_URL;
      } else {
        process.env.AMPLITUDE_WIZARD_SIGNUP_URL = original;
      }
    }
  });
});
