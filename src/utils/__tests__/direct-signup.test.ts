import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { performDirectSignup } from '../direct-signup';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('performDirectSignup', () => {
  it('returns success with tokens on 200', async () => {
    server.use(
      http.post('https://auth.amplitude.com/signup', () =>
        HttpResponse.json({
          access_token: 'a',
          id_token: 'i',
          refresh_token: 'r',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      ),
    );

    const result = await performDirectSignup({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.tokens.accessToken).toBe('a');
      expect(result.tokens.idToken).toBe('i');
      expect(result.tokens.refreshToken).toBe('r');
      expect(result.tokens.zone).toBe('us');
    }
  });

  it('returns requires_redirect when body is { requires_redirect: true }', async () => {
    server.use(
      http.post('https://auth.amplitude.com/signup', () =>
        HttpResponse.json({ requires_redirect: true }),
      ),
    );
    const result = await performDirectSignup({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });
    expect(result.kind).toBe('requires_redirect');
  });

  it('returns requires_redirect on HTTP 409', async () => {
    server.use(
      http.post('https://auth.amplitude.com/signup', () =>
        HttpResponse.json({ error: 'conflict' }, { status: 409 }),
      ),
    );
    const result = await performDirectSignup({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });
    expect(result.kind).toBe('requires_redirect');
  });

  it('returns error on network failure', async () => {
    server.use(
      http.post('https://auth.amplitude.com/signup', () =>
        HttpResponse.error(),
      ),
    );
    const result = await performDirectSignup({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });
    expect(result.kind).toBe('error');
  });

  it('returns error on 200 with unexpected body shape', async () => {
    server.use(
      http.post('https://auth.amplitude.com/signup', () =>
        HttpResponse.json({}),
      ),
    );
    const result = await performDirectSignup({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'us',
    });
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('Unexpected response');
    }
  });

  it('routes EU requests to auth.eu.amplitude.com', async () => {
    let observedUrl = '';
    server.use(
      http.post('https://auth.eu.amplitude.com/signup', ({ request }) => {
        observedUrl = request.url;
        return HttpResponse.json({
          access_token: 'a',
          id_token: 'i',
          refresh_token: 'r',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }),
    );
    await performDirectSignup({
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      zone: 'eu',
    });
    expect(observedUrl).toBe('https://auth.eu.amplitude.com/signup');
  });
});
