/**
 * Unit tests for createWizardDashboard.
 *
 * Axios is mocked at the module boundary so we assert the outgoing request
 * shape (URL, headers, Idempotency-Key, body) plus the full retry ladder
 * (401/429/500/503) and every terminal WizardDashboardErrorCode.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import {
  ApiError,
  createWizardDashboard,
  type CreateWizardDashboardRequest,
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

vi.mock('../../utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    captureException: vi.fn(),
  },
}));

const mockedAxios = axios as unknown as {
  post: ReturnType<typeof vi.fn>;
};

const IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000001';

function makeRequestBody(
  overrides: Partial<CreateWizardDashboardRequest> = {},
): CreateWizardDashboardRequest {
  return {
    orgId: 'org-1',
    appId: '12345',
    product: {
      name: 'Production',
      framework: 'nextjs',
    },
    events: [
      { name: 'user signed up', description: 'Auth completes' },
      { name: 'product viewed', description: 'Detail page view' },
    ],
    autocaptureEnabled: true,
    ...overrides,
  };
}

function makeSuccessResponse() {
  return {
    status: 200,
    headers: {},
    data: {
      dashboard: {
        id: 'dash-1',
        url: 'https://app.amplitude.com/acme/dashboard/dash-1',
        name: 'Wizard dashboard',
      },
      charts: [
        {
          id: 'chart-1',
          title: 'Signup funnel',
          type: 'FUNNELS',
          section: 'ACTIVATION',
          skipped: false,
        },
      ],
      warnings: [],
    },
  };
}

function makeErrorResponse(
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
) {
  return {
    status,
    headers,
    data: { error: { code, message } },
  };
}

describe('createWizardDashboard', () => {
  beforeEach(() => {
    mockedAxios.post.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('POSTs to {base}/v1/dashboards with Bearer token + Idempotency-Key header', async () => {
    mockedAxios.post.mockResolvedValueOnce(makeSuccessResponse());

    const result = await createWizardDashboard(
      'access-token-abc',
      'us',
      makeRequestBody(),
      IDEMPOTENCY_KEY,
    );

    expect(result.dashboard.id).toBe('dash-1');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);

    const [url, body, config] = mockedAxios.post.mock.calls[0];
    expect(String(url).endsWith('/v1/dashboards')).toBe(true);
    expect((body as CreateWizardDashboardRequest).orgId).toBe('org-1');
    expect((body as CreateWizardDashboardRequest).appId).toBe('12345');
    expect((body as CreateWizardDashboardRequest).events).toHaveLength(2);
    expect((body as CreateWizardDashboardRequest).autocaptureEnabled).toBe(
      true,
    );

    const headers = (config as { headers: Record<string, string> }).headers;
    expect(headers.Authorization).toBe('Bearer access-token-abc');
    expect(headers['Idempotency-Key']).toBe(IDEMPOTENCY_KEY);
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('throws UNAUTHENTICATED on 401 without retrying', async () => {
    mockedAxios.post.mockResolvedValueOnce(
      makeErrorResponse(401, 'UNAUTHENTICATED', 'Token expired'),
    );

    await expect(
      createWizardDashboard(
        'access-token',
        'us',
        makeRequestBody(),
        IDEMPOTENCY_KEY,
      ),
    ).rejects.toMatchObject({
      name: 'ApiError',
      code: 'UNAUTHENTICATED',
      statusCode: 401,
    });
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('throws FORBIDDEN on 403 terminal', async () => {
    mockedAxios.post.mockResolvedValueOnce(
      makeErrorResponse(403, 'FORBIDDEN', 'Not a member of this org'),
    );

    await expect(
      createWizardDashboard(
        'access-token',
        'us',
        makeRequestBody(),
        IDEMPOTENCY_KEY,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('retries 500 once then returns success, reusing same idempotency key', async () => {
    mockedAxios.post
      .mockResolvedValueOnce(
        makeErrorResponse(500, 'INTERNAL', 'Transient server error'),
      )
      .mockResolvedValueOnce(makeSuccessResponse());

    const promise = createWizardDashboard(
      'access-token',
      'us',
      makeRequestBody(),
      IDEMPOTENCY_KEY,
    );
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.dashboard.id).toBe('dash-1');
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    // Same idempotency key on the retry
    expect(mockedAxios.post.mock.calls[0][2].headers['Idempotency-Key']).toBe(
      IDEMPOTENCY_KEY,
    );
    expect(mockedAxios.post.mock.calls[1][2].headers['Idempotency-Key']).toBe(
      IDEMPOTENCY_KEY,
    );
  });

  it('surfaces 500 after the single retry budget is exhausted', async () => {
    mockedAxios.post
      .mockResolvedValueOnce(makeErrorResponse(500, 'INTERNAL', 'fail 1'))
      .mockResolvedValueOnce(makeErrorResponse(500, 'INTERNAL', 'fail 2'));

    const promise = createWizardDashboard(
      'access-token',
      'us',
      makeRequestBody(),
      IDEMPOTENCY_KEY,
    );
    // Attach catch synchronously so the eventual rejection doesn't trip
    // Vitest's "unhandled rejection" detector while fake timers drain.
    promise.catch(() => undefined);
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toMatchObject({
      code: 'INTERNAL',
      statusCode: 500,
    });
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  it('retries 429 up to 2 times honoring Retry-After header', async () => {
    mockedAxios.post
      .mockResolvedValueOnce(
        makeErrorResponse(429, 'RATE_LIMITED', 'slow down', {
          'retry-after': '1',
        }),
      )
      .mockResolvedValueOnce(
        makeErrorResponse(429, 'RATE_LIMITED', 'still slow', {
          'retry-after': '1',
        }),
      )
      .mockResolvedValueOnce(makeSuccessResponse());

    const promise = createWizardDashboard(
      'access-token',
      'us',
      makeRequestBody(),
      IDEMPOTENCY_KEY,
    );
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.dashboard.id).toBe('dash-1');
    expect(mockedAxios.post).toHaveBeenCalledTimes(3);
  });

  it('retries 503 up to 2 times with exponential backoff', async () => {
    mockedAxios.post
      .mockResolvedValueOnce(makeErrorResponse(503, 'UNAVAILABLE', 'down 1'))
      .mockResolvedValueOnce(makeErrorResponse(503, 'UNAVAILABLE', 'down 2'))
      .mockResolvedValueOnce(makeSuccessResponse());

    const promise = createWizardDashboard(
      'access-token',
      'us',
      makeRequestBody(),
      IDEMPOTENCY_KEY,
    );
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.dashboard.id).toBe('dash-1');
    expect(mockedAxios.post).toHaveBeenCalledTimes(3);
  });

  it('gives up on 429 after 2 retries (3 total attempts)', async () => {
    mockedAxios.post.mockResolvedValue(
      makeErrorResponse(429, 'RATE_LIMITED', 'slow down', {
        'retry-after': '1',
      }),
    );

    const promise = createWizardDashboard(
      'access-token',
      'us',
      makeRequestBody(),
      IDEMPOTENCY_KEY,
    );
    promise.catch(() => undefined);
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      statusCode: 429,
    });
    expect(mockedAxios.post).toHaveBeenCalledTimes(3);
  });

  it('does not retry 400 INVALID_REQUEST', async () => {
    mockedAxios.post.mockResolvedValueOnce(
      makeErrorResponse(400, 'INVALID_REQUEST', 'events required'),
    );

    await expect(
      createWizardDashboard(
        'access-token',
        'us',
        makeRequestBody(),
        IDEMPOTENCY_KEY,
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      statusCode: 400,
    });
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('does not retry 409 IDEMPOTENCY_CONFLICT', async () => {
    mockedAxios.post.mockResolvedValueOnce(
      makeErrorResponse(
        409,
        'IDEMPOTENCY_CONFLICT',
        'Key reused with different body',
      ),
    );

    await expect(
      createWizardDashboard(
        'access-token',
        'us',
        makeRequestBody(),
        IDEMPOTENCY_KEY,
      ),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      statusCode: 409,
    });
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('maps an unrecognized success body to INTERNAL', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      headers: {},
      data: { dashboard: 'not-an-object' },
    });

    await expect(
      createWizardDashboard(
        'access-token',
        'us',
        makeRequestBody(),
        IDEMPOTENCY_KEY,
      ),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('surfaces ENGAGEMENT_EVENTS_CAPPED warning from a 200 response', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      headers: {},
      data: {
        dashboard: {
          id: 'dash-2',
          url: 'https://app.amplitude.com/acme/dashboard/dash-2',
          name: 'Wizard dashboard',
        },
        charts: [],
        warnings: [
          {
            code: 'ENGAGEMENT_EVENTS_CAPPED',
            message: 'Capped to 4 events',
          },
        ],
      },
    });

    const result = await createWizardDashboard(
      'access-token',
      'us',
      makeRequestBody(),
      IDEMPOTENCY_KEY,
    );

    expect(result.warnings).toEqual([
      { code: 'ENGAGEMENT_EVENTS_CAPPED', message: 'Capped to 4 events' },
    ]);
  });
});
