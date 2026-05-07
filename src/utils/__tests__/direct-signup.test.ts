import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import axios from 'axios';
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

  it('accepts empty-string dashboard_url and surfaces it as null', async () => {
    server.use(
      http.post(PROVISIONING_URL, () =>
        HttpResponse.json({
          type: 'oauth',
          oauth: { code: 'auth-code-xyz' },
          dashboard_url: '',
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

  it('returns needs_information with the server-requested required fields', async () => {
    // Shape mirrors the live server response — JSON-Schema is wrapped in
    // an extra `schema` field. Verified via direct curl on 2026-05-06.
    server.use(
      http.post(PROVISIONING_URL, () =>
        HttpResponse.json({
          type: 'needs_information',
          needs_information: {
            schema: {
              type: 'object',
              properties: {
                full_name: { type: 'string', description: 'Full Name' },
              },
              required: ['full_name'],
            },
          },
        }),
      ),
    );

    const result = await performDirectSignup({
      email: 'ada@example.com',
      zone: 'us',
    });

    expect(result.kind).toBe('needs_information');
    if (result.kind === 'needs_information') {
      expect(result.requiredFields).toEqual(['full_name']);
    }
  });

  it('accepts properties values with or without optional metadata', async () => {
    // The wire contract treats each property's value as opaque to the
    // wizard — `description` is cosmetic and may be removed without
    // notice. This test pins that contract: a parse must succeed on
    // BOTH `{ type }` (no description) and an entirely empty value
    // `{}` (no fields at all). If you tighten `NeedsInformationSchema`
    // and break this, the wizard would silently fail-closed when the
    // server changes the JSON-Schema property descriptors.
    let observedRequiredFields: string[] | null = null;
    server.use(
      http.post(PROVISIONING_URL, () =>
        HttpResponse.json({
          type: 'needs_information',
          needs_information: {
            schema: {
              type: 'object',
              properties: {
                full_name: { type: 'string' }, // no description
                future_field: {}, // no fields at all
              },
              required: ['full_name'],
            },
          },
        }),
      ),
    );

    const result = await performDirectSignup({
      email: 'ada@example.com',
      zone: 'us',
    });

    expect(result.kind).toBe('needs_information');
    if (result.kind === 'needs_information') {
      observedRequiredFields = result.requiredFields;
    }
    expect(observedRequiredFields).toEqual(['full_name']);
  });

  // ── needs_information `required` shape gate (schema-layer) ───────────
  //
  // The schema's `.refine()` enforces that `required` is exactly
  // `['full_name']`. Any other shape (additional fields, missing fields,
  // empty array, substituted field) means the server's contract has
  // drifted past what this client supports — the parse fails, and the
  // type-aware fall-through detects `type === 'needs_information'` and
  // returns `kind: 'error'` with `code: 'unsupported_required_shape'`.
  // The wrapper maps that code to a distinct telemetry status.

  it.each([
    ['unknown field only', ['company']],
    ['mixed full_name + unknown', ['full_name', 'company']],
    ['empty required array', []],
    ['unsupported substitute', ['email_verified']],
    ['only full_name but with extras', ['full_name', 'phone']],
  ])(
    'rejects needs_information with %s as unsupported_required_shape',
    async (_label, requiredFields) => {
      server.use(
        http.post(PROVISIONING_URL, () =>
          HttpResponse.json({
            type: 'needs_information',
            needs_information: {
              schema: {
                type: 'object',
                properties: Object.fromEntries(
                  requiredFields.map((f) => [f, { type: 'string' }]),
                ),
                required: requiredFields,
              },
            },
          }),
        ),
      );

      const result = await performDirectSignup({
        email: 'ada@example.com',
        zone: 'us',
      });

      expect(result.kind).toBe('error');
      if (result.kind === 'error') {
        expect(result.code).toBe('unsupported_required_shape');
      }
    },
  );

  it('accepts the canonical `["full_name"]` shape (schema gate passes)', async () => {
    // Companion to the table above: pin the one shape that DOES pass
    // through the schema, so the gate's positive path is also covered.
    server.use(
      http.post(PROVISIONING_URL, () =>
        HttpResponse.json({
          type: 'needs_information',
          needs_information: {
            schema: {
              type: 'object',
              properties: { full_name: { type: 'string' } },
              required: ['full_name'],
            },
          },
        }),
      ),
    );

    const result = await performDirectSignup({
      email: 'ada@example.com',
      zone: 'us',
    });

    expect(result.kind).toBe('needs_information');
  });

  it('omits full_name from the request body when fullName is not supplied', async () => {
    let observedBody: Record<string, unknown> | null = null;
    server.use(
      http.post(PROVISIONING_URL, async ({ request }) => {
        observedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          type: 'needs_information',
          needs_information: {
            schema: {
              type: 'object',
              properties: { full_name: { type: 'string' } },
              required: ['full_name'],
            },
          },
        });
      }),
    );

    await performDirectSignup({ email: 'ada@example.com', zone: 'us' });

    expect(observedBody).not.toBeNull();
    expect(observedBody!).not.toHaveProperty('full_name');
    expect(observedBody!.email).toBe('ada@example.com');
  });

  it('includes full_name in the request body when fullName is supplied', async () => {
    let observedBody: Record<string, unknown> | null = null;
    server.use(
      http.post(PROVISIONING_URL, async ({ request }) => {
        observedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ type: 'oauth', oauth: { code: 'c' } });
      }),
      http.post(TOKEN_URL, () => HttpResponse.json(VALID_TOKEN_RESPONSE)),
    );

    await performDirectSignup(INPUT);

    expect(observedBody).not.toBeNull();
    expect(observedBody!.full_name).toBe('Ada Lovelace');
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

  it('returns aborted when the provisioning POST is cancelled by the caller', async () => {
    const controller = new AbortController();
    vi.spyOn(axios, 'post').mockImplementation(async () => {
      controller.abort();
      const err = new Error('canceled') as Error & { code?: string };
      err.code = 'ERR_CANCELED';
      throw err;
    });

    try {
      const result = await performDirectSignup({
        ...INPUT,
        signal: controller.signal,
      });

      expect(result.kind).toBe('error');
      if (result.kind === 'error') {
        expect(result.code).toBe('aborted');
        expect(result.message).toBe('aborted');
      }
    } finally {
      vi.restoreAllMocks();
    }
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

  it('returns aborted when the token exchange POST is cancelled by the caller', async () => {
    const controller = new AbortController();
    vi.spyOn(axios, 'post').mockImplementation(async (url: string) => {
      if (url.includes('/t/agentic/signup/v1')) {
        return {
          status: 200,
          data: { type: 'oauth', oauth: { code: 'auth-code-xyz' } },
        };
      }
      controller.abort();
      const err = new Error('canceled') as Error & { code?: string };
      err.code = 'ERR_CANCELED';
      throw err;
    });

    try {
      const result = await performDirectSignup({
        ...INPUT,
        signal: controller.signal,
      });

      expect(result.kind).toBe('error');
      if (result.kind === 'error') {
        expect(result.code).toBe('aborted');
        expect(result.message).toBe('aborted');
      }
    } finally {
      vi.restoreAllMocks();
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

  // ── Inner abort guards ────────────────────────────────────────────────
  //
  // `performDirectSignup` has two `if (input.signal?.aborted)` guards
  // that fire AFTER axios resolves successfully but BEFORE the next
  // step runs:
  //   1. After the provisioning POST — bails before token-exchange.
  //   2. After the token-exchange POST — bails before parsing tokens
  //      and returning a `success` arm.
  // These cover the race where the caller aborts (Esc back, /exit) just
  // as the response lands on the wire: axios has already resolved, so
  // the catch-block path doesn't fire, but the user has navigated away
  // and the result must not feed into downstream side effects (token
  // persistence). Tests stub `axios.post` so the abort lands
  // deterministically between resolve and the guard — MSW can't
  // synchronize that window because it operates below axios.

  it('post-provisioning guard: aborts after first POST resolves and before token exchange', async () => {
    const controller = new AbortController();
    let provisioningCalled = false;
    let tokenCalled = false;
    vi.spyOn(axios, 'post').mockImplementation(async (url: string) => {
      if (url.includes('/t/agentic/signup/v1')) {
        provisioningCalled = true;
        // Abort synchronously before returning. By the time
        // `await axios.post(...)` unwraps in performDirectSignup,
        // signal.aborted is already true and the guard fires on the
        // next line — token exchange must not run.
        controller.abort();
        return {
          status: 200,
          data: { type: 'oauth', oauth: { code: 'auth-code-xyz' } },
        };
      }
      if (url.includes('/oauth2/token')) {
        tokenCalled = true;
        return { status: 200, data: VALID_TOKEN_RESPONSE };
      }
      throw new Error(`unexpected url ${url}`);
    });

    try {
      const result = await performDirectSignup({
        ...INPUT,
        signal: controller.signal,
      });

      expect(provisioningCalled).toBe(true);
      expect(tokenCalled).toBe(false);
      expect(result.kind).toBe('error');
      if (result.kind === 'error') {
        expect(result.code).toBe('aborted');
        expect(result.message).toBe('aborted');
      }
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('post-token-exchange guard: aborts after token POST resolves and before returning success', async () => {
    const controller = new AbortController();
    vi.spyOn(axios, 'post').mockImplementation(async (url: string) => {
      if (url.includes('/t/agentic/signup/v1')) {
        return {
          status: 200,
          data: { type: 'oauth', oauth: { code: 'auth-code-xyz' } },
        };
      }
      if (url.includes('/oauth2/token')) {
        // Same pattern as the post-provisioning guard test, but for the
        // second guard: abort after the token-exchange resolves so the
        // function bails to error{code:'aborted'} instead of returning
        // a success arm whose tokens would be persisted to disk.
        controller.abort();
        return { status: 200, data: VALID_TOKEN_RESPONSE };
      }
      throw new Error(`unexpected url ${url}`);
    });

    try {
      const result = await performDirectSignup({
        ...INPUT,
        signal: controller.signal,
      });

      expect(result.kind).toBe('error');
      if (result.kind === 'error') {
        expect(result.code).toBe('aborted');
        expect(result.message).toBe('aborted');
      }
    } finally {
      vi.restoreAllMocks();
    }
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
