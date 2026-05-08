/**
 * Unit tests for createAmplitudeApp + friends.
 *
 * Axios is mocked at the module boundary so we can assert both the outgoing
 * request shape (URL, headers, body) and the handling of every error code
 * the proxy can return.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createAmplitudeApp,
  validateProjectName,
  getWizardProxyBase,
  ApiError,
  PROJECT_NAME_MAX_LENGTH,
} from '../api';

// `src/lib/api.ts` now uses a shared `axios.create()` instance so we can
// attach a keep-alive agent and a default timeout. The test mock has to
// route both `axios.post` and the shared instance's `.post` to the same
// `vi.fn()` so existing assertions on call args still pass. We use
// `vi.hoisted()` so `mockPost` is available inside the hoisted `vi.mock`
// factory.
const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }));
vi.mock('axios', async () => {
  const actual = await vi.importActual<typeof import('axios')>('axios');
  return {
    default: {
      ...actual.default,
      post: mockPost,
      create: () => ({ post: mockPost, get: vi.fn() }),
      isAxiosError: actual.default.isAxiosError,
    },
  };
});

// Silence analytics side-effects during tests.
vi.mock('../../utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    captureException: vi.fn(),
  },
}));

// Backwards-compatible alias for the existing assertions below — the actual
// shared mock is `mockPost` (declared above so it can be wired into
// `axios.create()` at hoist time).
const mockedAxios = { post: mockPost } as unknown as {
  post: ReturnType<typeof vi.fn>;
};

function makeAxiosError(
  status: number,
  data: unknown,
  message = `Request failed with status code ${status}`,
) {
  return Object.assign(new Error(message), {
    isAxiosError: true,
    response: { status, data },
    config: { url: 'https://example.test/wizard/projects' },
    toJSON: () => ({}),
  });
}

describe('validateProjectName', () => {
  it('accepts ordinary names', () => {
    expect(validateProjectName('My Project')).toBeNull();
    expect(validateProjectName('a')).toBeNull();
  });

  it('rejects empty / whitespace', () => {
    expect(validateProjectName('')?.code).toBe('empty');
    expect(validateProjectName('   ')?.code).toBe('empty');
  });

  it('rejects names longer than the max length', () => {
    const tooLong = 'a'.repeat(PROJECT_NAME_MAX_LENGTH + 1);
    expect(validateProjectName(tooLong)?.code).toBe('too_long');
  });

  it('rejects control characters', () => {
    expect(validateProjectName('bad\x00name')?.code).toBe('control_chars');
    expect(validateProjectName('bad\x1fname')?.code).toBe('control_chars');
  });
});

describe('getWizardProxyBase', () => {
  // getWizardProxyBase is the Amplitude DATA API base — separate surface
  // from the LLM proxy. It still needs to be region-pinned to
  // core.amplitude.com / core.eu.amplitude.com because it serves
  // /v1/projects (project creation) and /v1/planned-events (taxonomy).
  // The LLM transport moved to wizard.amplitude.com; see
  // getLlmGatewayUrlFromHost in src/utils/urls.ts.

  it('returns the US data API base for the us zone', () => {
    const prev = process.env.WIZARD_PROXY_BASE_URL;
    delete process.env.WIZARD_PROXY_BASE_URL;
    try {
      expect(getWizardProxyBase('us')).toBe(
        'https://core.amplitude.com/wizard',
      );
    } finally {
      if (prev !== undefined) process.env.WIZARD_PROXY_BASE_URL = prev;
    }
  });

  it('returns the EU data API base for the eu zone', () => {
    const prev = process.env.WIZARD_PROXY_BASE_URL;
    delete process.env.WIZARD_PROXY_BASE_URL;
    try {
      expect(getWizardProxyBase('eu')).toBe(
        'https://core.eu.amplitude.com/wizard',
      );
    } finally {
      if (prev !== undefined) process.env.WIZARD_PROXY_BASE_URL = prev;
    }
  });

  it('respects WIZARD_PROXY_BASE_URL override', () => {
    const prev = process.env.WIZARD_PROXY_BASE_URL;
    process.env.WIZARD_PROXY_BASE_URL = 'http://localhost:4999/wizard';
    try {
      expect(getWizardProxyBase('us')).toBe('http://localhost:4999/wizard');
      expect(getWizardProxyBase('eu')).toBe('http://localhost:4999/wizard');
    } finally {
      if (prev === undefined) delete process.env.WIZARD_PROXY_BASE_URL;
      else process.env.WIZARD_PROXY_BASE_URL = prev;
    }
  });

  it('does NOT consult WIZARD_LLM_PROXY_URL — that env var is for the LLM proxy only', () => {
    // Regression: previously getWizardProxyBase derived from
    // getLlmGatewayUrlFromHost, which meant overriding WIZARD_LLM_PROXY_URL
    // also changed the project-creation endpoint. After decoupling the LLM
    // proxy onto wizard.amplitude.com, that coupling broke the data API
    // and is no longer wanted.
    const prevLlm = process.env.WIZARD_LLM_PROXY_URL;
    const prevProxy = process.env.WIZARD_PROXY_BASE_URL;
    process.env.WIZARD_LLM_PROXY_URL = 'http://localhost:8010';
    delete process.env.WIZARD_PROXY_BASE_URL;
    try {
      expect(getWizardProxyBase('us')).toBe(
        'https://core.amplitude.com/wizard',
      );
    } finally {
      if (prevLlm === undefined) delete process.env.WIZARD_LLM_PROXY_URL;
      else process.env.WIZARD_LLM_PROXY_URL = prevLlm;
      if (prevProxy !== undefined)
        process.env.WIZARD_PROXY_BASE_URL = prevProxy;
    }
  });
});

describe('createAmplitudeApp', () => {
  beforeEach(() => {
    mockedAxios.post.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('POSTs to {base}/projects with a Bearer access token in Authorization', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: { appId: '12345', apiKey: 'secret-key', name: 'My Project' },
    });

    const result = await createAmplitudeApp('access-token-abc', 'us', {
      orgId: 'org-1',
      name: 'My Project',
    });

    expect(result).toEqual({
      appId: '12345',
      apiKey: 'secret-key',
      name: 'My Project',
    });
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const [url, body, config] = mockedAxios.post.mock.calls[0];
    expect(String(url).endsWith('/projects')).toBe(true);
    // The wizard-proxy auth middleware introspects via Hydra — needs an
    // OAuth access token with the `Bearer ` prefix.
    expect(config.headers.Authorization).toBe('Bearer access-token-abc');
    expect(config.headers['Content-Type']).toBe('application/json');
    expect(config.headers['User-Agent']).toMatch(/amplitude\/wizard/);
    expect(body).toEqual({ orgId: 'org-1', name: 'My Project' });
  });

  it('includes description when provided', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: { appId: '1', apiKey: 'k', name: 'P' },
    });
    await createAmplitudeApp('tok', 'us', {
      orgId: 'org',
      name: 'P',
      description: 'A cool project',
    });
    const body = mockedAxios.post.mock.calls[0][1] as Record<string, unknown>;
    expect(body.description).toBe('A cool project');
  });

  it.each([
    ['NAME_TAKEN', 409],
    ['QUOTA_REACHED', 402],
    ['FORBIDDEN', 403],
    ['INVALID_REQUEST', 400],
    ['INTERNAL', 500],
  ] as const)('maps %s error code from backend', async (code, status) => {
    mockedAxios.post.mockRejectedValueOnce(
      makeAxiosError(status, {
        error: { code, message: `something about ${code}` },
      }),
    );

    await expect(
      createAmplitudeApp('tok', 'us', { orgId: 'org', name: 'Name' }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      code,
      statusCode: status,
    });
  });

  it('falls back to INTERNAL when the error body is malformed', async () => {
    mockedAxios.post.mockRejectedValueOnce(
      makeAxiosError(500, { something: 'unexpected' }),
    );
    await expect(
      createAmplitudeApp('tok', 'us', { orgId: 'org', name: 'Name' }),
    ).rejects.toMatchObject({ code: 'INTERNAL', statusCode: 500 });
  });

  it('preserves 429 meaning when error body is malformed', async () => {
    mockedAxios.post.mockRejectedValueOnce(makeAxiosError(429, {}));
    await expect(
      createAmplitudeApp('tok', 'us', { orgId: 'org', name: 'Name' }),
    ).rejects.toMatchObject({
      code: 'INTERNAL',
      statusCode: 429,
      message: expect.stringContaining('Rate limited'),
    });
  });

  it('validates name locally before hitting the network', async () => {
    await expect(
      createAmplitudeApp('tok', 'us', { orgId: 'org', name: '' }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('validates orgId locally before hitting the network', async () => {
    await expect(
      createAmplitudeApp('tok', 'us', { orgId: '', name: 'Valid' }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('wraps network failures as ApiError with INTERNAL code', async () => {
    // Simulate a raw thrown axios error (network / DNS failure).
    const networkErr = Object.assign(new Error('ECONNREFUSED'), {
      isAxiosError: true,
      toJSON: () => ({}),
      config: {},
    });
    mockedAxios.post.mockRejectedValueOnce(networkErr);
    await expect(
      createAmplitudeApp('tok', 'us', { orgId: 'org', name: 'Name' }),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('trims whitespace from the name in the outgoing body', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: { appId: '1', apiKey: 'k', name: 'Trimmed' },
    });
    await createAmplitudeApp('tok', 'us', {
      orgId: 'org',
      name: '   Trimmed   ',
    });
    const body = mockedAxios.post.mock.calls[0][1] as Record<string, unknown>;
    expect(body.name).toBe('Trimmed');
  });
});
