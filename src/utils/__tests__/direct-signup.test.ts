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

// Mock the analytics singleton — direct-signup pulls `getAnonymousId()` to
// forward the wizard's persistent install UUID as `device_id` in the request
// body. Mocking sidesteps the real singleton's disk read of
// ~/.amp-wizard/install-id and gives the body-shape tests a deterministic
// value to assert against.
vi.mock('../analytics', () => ({
  analytics: { getAnonymousId: () => 'test-device-id-uuid' },
}));

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

// `kind: 'with_required_fields'` is the shape used by tests that exercise the
// success/error paths after fields have been collected — they mock a
// success/redirect/error response from the provisioning endpoint, so
// the body the wizard would actually send doesn't matter for those
// tests; what matters is that the input is type-valid.
const INPUT = {
  kind: 'with_required_fields',
  email: 'ada@example.com',
  fullName: 'Ada Lovelace',
  legalDocumentBundle: {
    terms_of_service: 'https://amplitude.com/terms',
    privacy_policy: 'https://amplitude.com/privacy',
  },
  zone: 'us',
} as const;

// Initial-shape input for tests that exercise the probe path
// (needs_information / requires_redirect responses).
const INITIAL_INPUT = {
  kind: 'email_only',
  email: 'ada@example.com',
  zone: 'us',
} as const;

// Follow-up POST shapes that carry only one of the `with_required_fields`
// slots — the body builder emits each slot only when its source field
// is supplied.
const FULL_NAME_ONLY_INPUT = {
  kind: 'with_required_fields',
  email: 'ada@example.com',
  fullName: 'Ada Lovelace',
  zone: 'us',
} as const;

const TERMS_ONLY_INPUT = {
  kind: 'with_required_fields',
  email: 'ada@example.com',
  legalDocumentBundle: {
    terms_of_service: 'https://amplitude.com/terms',
    privacy_policy: 'https://amplitude.com/privacy',
  },
  legalDocumentSource: 'server',
  zone: 'us',
} as const;

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
      kind: 'email_only',
      email: 'ada@example.com',
      zone: 'us',
    });

    expect(result.kind).toBe('needs_information');
    if (result.kind === 'needs_information') {
      // The parser's spoof block injects 'terms_acceptance' into
      // requiredFields when BE doesn't include it (Phase A behavior).
      // After the BE flag flips ON across env tiers, BE will return both
      // and the spoof's `else` branch becomes a no-op.
      expect(result.requiredFields).toEqual(['full_name', 'terms_acceptance']);
      expect(result.legalDocumentSource).toBe('local');
      expect(result.legalDocumentBundle).toEqual({
        terms_of_service: 'https://amplitude.com/terms',
        privacy_policy: 'https://amplitude.com/privacy',
      });
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
      kind: 'email_only',
      email: 'ada@example.com',
      zone: 'us',
    });

    expect(result.kind).toBe('needs_information');
    if (result.kind === 'needs_information') {
      observedRequiredFields = result.requiredFields;
    }
    // Spoof injects 'terms_acceptance' when BE didn't return it.
    expect(observedRequiredFields).toEqual(['full_name', 'terms_acceptance']);
  });

  // ── needs_information `required` shape gate (schema-layer) ───────────
  //
  // The schema accepts any non-empty subset of `KNOWN_REQUIRED_KEYS` via
  // `z.array(z.enum(KNOWN_REQUIRED_KEYS)).nonempty()`. Any shape outside
  // that (unknown kinds, empty array, or a mix that includes an unknown
  // kind) means the server's contract has drifted past what this client
  // supports — the parse fails, the type-aware fall-through detects
  // `type === 'needs_information'`, and returns `kind: 'error'` with
  // `code: 'unsupported_required_shape'`. The wrapper maps that code to
  // a distinct telemetry status.

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
        kind: 'email_only',
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
    // Companion to the table above: pin a shape that DOES pass through
    // the schema, so the gate's positive path is also covered.
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
      kind: 'email_only',
      email: 'ada@example.com',
      zone: 'us',
    });

    expect(result.kind).toBe('needs_information');
  });

  // ── needs_information `terms_acceptance` parsing (Phase A spoof) ──────
  //
  // Three behaviors pinned here:
  //   - BE flag OFF (no terms_acceptance in `required`): spoof block
  //     synthesizes local URLs and injects 'terms_acceptance' into
  //     requiredFields. Source = 'local'.
  //   - BE flag ON, valid documents: parser extracts URLs via the
  //     transform-based schema. Source = 'server'.
  //   - BE flag ON but documents are missing/malformed: invariant
  //     violation — return unsupported_required_shape so the wizard falls
  //     back to OAuth.
  //
  // The `legalDocumentBundle ↔ 'terms_acceptance' in requiredFields`
  // invariant is part of the parser's contract; downstream (screen, body
  // construction) relies on it.

  it('flag-OFF (no terms_acceptance in required) spoofs local URLs and injects the kind', async () => {
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
      kind: 'email_only',
      email: 'ada@example.com',
      zone: 'us',
    });

    expect(result.kind).toBe('needs_information');
    if (result.kind === 'needs_information') {
      expect(result.requiredFields).toEqual(['full_name', 'terms_acceptance']);
      expect(result.legalDocumentSource).toBe('local');
      expect(result.legalDocumentBundle).toEqual({
        terms_of_service: 'https://amplitude.com/terms',
        privacy_policy: 'https://amplitude.com/privacy',
      });
    }
  });

  it('flag-ON with valid terms_acceptance documents: passes BE URLs through', async () => {
    server.use(
      http.post(PROVISIONING_URL, () =>
        HttpResponse.json({
          type: 'needs_information',
          needs_information: {
            schema: {
              type: 'object',
              properties: {
                terms_acceptance: {
                  type: 'object',
                  documents: [
                    {
                      kind: 'terms_of_service',
                      url: 'https://example.test/terms-v2',
                    },
                    {
                      kind: 'privacy_policy',
                      url: 'https://example.test/privacy-v2',
                    },
                  ],
                },
                full_name: { type: 'string' },
              },
              required: ['terms_acceptance', 'full_name'],
            },
          },
        }),
      ),
    );

    const result = await performDirectSignup({
      kind: 'email_only',
      email: 'ada@example.com',
      zone: 'us',
    });

    expect(result.kind).toBe('needs_information');
    if (result.kind === 'needs_information') {
      expect(result.requiredFields).toEqual(['terms_acceptance', 'full_name']);
      expect(result.legalDocumentSource).toBe('server');
      expect(result.legalDocumentBundle).toEqual({
        terms_of_service: 'https://example.test/terms-v2',
        privacy_policy: 'https://example.test/privacy-v2',
      });
    }
  });

  it('flag-ON with terms_acceptance alone (no full_name required) returns needs_information', async () => {
    // `terms_acceptance` alone is a valid `needs_information.required`
    // subset; the wrapper must surface it so the ToS screen renders
    // and the follow-up POST carries only the terms_acceptance slot.
    server.use(
      http.post(PROVISIONING_URL, () =>
        HttpResponse.json({
          type: 'needs_information',
          needs_information: {
            schema: {
              type: 'object',
              properties: {
                terms_acceptance: {
                  type: 'object',
                  documents: [
                    {
                      kind: 'terms_of_service',
                      url: 'https://amplitude.com/terms',
                    },
                    {
                      kind: 'privacy_policy',
                      url: 'https://amplitude.com/privacy',
                    },
                  ],
                },
              },
              required: ['terms_acceptance'],
            },
          },
        }),
      ),
    );

    const result = await performDirectSignup({
      kind: 'email_only',
      email: 'ada@example.com',
      zone: 'us',
    });

    expect(result.kind).toBe('needs_information');
    if (result.kind === 'needs_information') {
      expect(result.requiredFields).toEqual(['terms_acceptance']);
      expect(result.legalDocumentSource).toBe('server');
      expect(result.legalDocumentBundle).toEqual({
        terms_of_service: 'https://amplitude.com/terms',
        privacy_policy: 'https://amplitude.com/privacy',
      });
    }
  });

  it.each([
    [
      'wrong array length (length 1)',
      [{ kind: 'terms_of_service', url: 'https://x.test/t' }],
    ],
    [
      'unknown kind',
      [
        { kind: 'terms_of_service', url: 'https://x.test/t' },
        { kind: 'dpa', url: 'https://x.test/d' },
      ],
    ],
    [
      'missing one of the two known kinds',
      [
        { kind: 'terms_of_service', url: 'https://x.test/t' },
        { kind: 'terms_of_service', url: 'https://x.test/t2' },
      ],
    ],
    [
      'malformed URL',
      [
        { kind: 'terms_of_service', url: 'not-a-url' },
        { kind: 'privacy_policy', url: 'https://x.test/p' },
      ],
    ],
    ['documents field missing entirely', undefined],
  ])(
    'flag-ON with %s in documents → unsupported_required_shape',
    async (_label, documents) => {
      server.use(
        http.post(PROVISIONING_URL, () =>
          HttpResponse.json({
            type: 'needs_information',
            needs_information: {
              schema: {
                type: 'object',
                properties: {
                  terms_acceptance:
                    documents === undefined ? {} : { documents },
                },
                required: ['terms_acceptance'],
              },
            },
          }),
        ),
      );

      const result = await performDirectSignup({
        kind: 'email_only',
        email: 'ada@example.com',
        zone: 'us',
      });

      expect(result.kind).toBe('error');
      if (result.kind === 'error') {
        expect(result.code).toBe('unsupported_required_shape');
      }
    },
  );

  it('always includes device_id from the analytics singleton in the request body', async () => {
    let observedBody: Record<string, unknown> | null = null;
    server.use(
      http.post(PROVISIONING_URL, async ({ request }) => {
        observedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ type: 'oauth', oauth: { code: 'c' } });
      }),
      http.post(TOKEN_URL, () => HttpResponse.json(VALID_TOKEN_RESPONSE)),
    );

    await performDirectSignup(INITIAL_INPUT);

    expect(observedBody).not.toBeNull();
    expect(observedBody!.device_id).toBe('test-device-id-uuid');
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

    await performDirectSignup({
      kind: 'email_only',
      email: 'ada@example.com',
      zone: 'us',
    });

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
    // Discriminated-union invariant: a `kind: 'with_required_fields'` input
    // always carries a complete `terms_acceptance` slot in the body.
    // Verifies that the body-construction switch produces both
    // documents with `accepted: true`.
    expect(observedBody!.terms_acceptance).toEqual({
      terms_of_service: {
        url: 'https://amplitude.com/terms',
        accepted: true,
      },
      privacy_policy: {
        url: 'https://amplitude.com/privacy',
        accepted: true,
      },
    });
  });

  it('omits terms_acceptance from the request body on initial-shape input', async () => {
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

    await performDirectSignup(INITIAL_INPUT);

    expect(observedBody).not.toBeNull();
    expect(observedBody!).not.toHaveProperty('terms_acceptance');
    expect(observedBody!).not.toHaveProperty('full_name');
  });

  // Per-combination body shapes — `fullName` and `legalDocumentBundle`
  // are independently optional on `with_required_fields`, so the body
  // builder emits each slot only when its source field is defined.
  it('with_required_fields body: fullName-only input emits full_name and omits terms_acceptance', async () => {
    let observedBody: Record<string, unknown> | null = null;
    server.use(
      http.post(PROVISIONING_URL, async ({ request }) => {
        observedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ type: 'oauth', oauth: { code: 'c' } });
      }),
      http.post(TOKEN_URL, () => HttpResponse.json(VALID_TOKEN_RESPONSE)),
    );

    await performDirectSignup(FULL_NAME_ONLY_INPUT);

    expect(observedBody).not.toBeNull();
    expect(observedBody!.full_name).toBe('Ada Lovelace');
    expect(observedBody!).not.toHaveProperty('terms_acceptance');
  });

  it('with_required_fields body: terms-only input emits terms_acceptance and omits full_name', async () => {
    let observedBody: Record<string, unknown> | null = null;
    server.use(
      http.post(PROVISIONING_URL, async ({ request }) => {
        observedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ type: 'oauth', oauth: { code: 'c' } });
      }),
      http.post(TOKEN_URL, () => HttpResponse.json(VALID_TOKEN_RESPONSE)),
    );

    await performDirectSignup(TERMS_ONLY_INPUT);

    expect(observedBody).not.toBeNull();
    expect(observedBody!).not.toHaveProperty('full_name');
    expect(observedBody!.terms_acceptance).toEqual({
      terms_of_service: {
        url: 'https://amplitude.com/terms',
        accepted: true,
      },
      privacy_policy: {
        url: 'https://amplitude.com/privacy',
        accepted: true,
      },
    });
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
      await performDirectSignup(INPUT);
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
