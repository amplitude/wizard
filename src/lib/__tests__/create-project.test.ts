/**
 * Unit tests for createAmplitudeApp + friends.
 *
 * Axios is mocked at the module boundary so we can assert both the outgoing
 * request shape (URL, headers, body) and the handling of every error code
 * the proxy can return.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import {
  createAmplitudeApp,
  validateProjectName,
  getWizardProxyBase,
  ApiError,
  PROJECT_NAME_MAX_LENGTH,
} from '../api';

vi.mock('axios', async () => {
  const actual = await vi.importActual<typeof import('axios')>('axios');
  return {
    default: {
      ...actual.default,
      post: vi.fn(),
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

const mockedAxios = axios as unknown as {
  post: ReturnType<typeof vi.fn>;
};

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
  it('returns the US base for the us zone', () => {
    const base = getWizardProxyBase('us');
    // In test/dev mode this may return a localhost override; the important
    // invariants are: no trailing slash and no /v1/messages suffix.
    expect(base.endsWith('/')).toBe(false);
    expect(base.endsWith('/v1/messages')).toBe(false);
  });

  it('returns the EU base for the eu zone', () => {
    const base = getWizardProxyBase('eu');
    expect(base.endsWith('/')).toBe(false);
    expect(base.endsWith('/v1/messages')).toBe(false);
  });

  it('respects WIZARD_LLM_PROXY_URL override', () => {
    const prev = process.env.WIZARD_LLM_PROXY_URL;
    process.env.WIZARD_LLM_PROXY_URL = 'http://localhost:4999/wizard';
    try {
      expect(getWizardProxyBase('us')).toBe('http://localhost:4999/wizard');
    } finally {
      if (prev === undefined) delete process.env.WIZARD_LLM_PROXY_URL;
      else process.env.WIZARD_LLM_PROXY_URL = prev;
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

  it('POSTs to {base}/projects with the raw id_token in Authorization', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: { appId: '12345', apiKey: 'secret-key', name: 'My Project' },
    });

    const result = await createAmplitudeApp('id-token-abc', 'us', {
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
    // id_token must be raw — no Bearer prefix.
    expect(config.headers.Authorization).toBe('id-token-abc');
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
    mockedAxios.post.mockResolvedValueOnce({
      status,
      data: { error: { code, message: `something about ${code}` } },
    });

    await expect(
      createAmplitudeApp('tok', 'us', { orgId: 'org', name: 'Name' }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      code,
      statusCode: status,
    });
  });

  it('falls back to INTERNAL when the error body is malformed', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 500,
      data: { something: 'unexpected' },
    });
    await expect(
      createAmplitudeApp('tok', 'us', { orgId: 'org', name: 'Name' }),
    ).rejects.toMatchObject({ code: 'INTERNAL', statusCode: 500 });
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
