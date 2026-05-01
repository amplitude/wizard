/**
 * Unit tests for commitPlannedEvents.
 *
 * Step 1 uses axios POST to wizard-proxy `/v1/planned-events` (mocked).
 * Step 2 uses Amplitude MCP `update_event` (fetch + SSE mocked).
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { commitPlannedEvents } from '../planned-events';
import { _clearMcpSessionCacheForTesting } from '../mcp-with-fallback';

vi.mock('../../utils/debug');

const mockAxiosPost = vi.fn();
vi.mock('axios', async () => {
  const actual = await vi.importActual<typeof import('axios')>('axios');
  return {
    default: {
      ...actual.default,
      post: (...args: unknown[]) => mockAxiosPost(...args),
      isAxiosError: actual.default.isAxiosError,
    },
  };
});

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockQuery = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

const SESSION_ID = 'test-session-id';

/** Matches getWizardProxyBase('us') when WIZARD_LLM_PROXY_URL is set. */
const PROXY_BASE = 'http://localhost:4999/wizard';

function makeFetchResponse(
  body: string,
  headers: Record<string, string> = {},
  status = 200,
): Response {
  return {
    status,
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
    text: () => Promise.resolve(body),
    body: { cancel: () => Promise.resolve() },
  } as unknown as Response;
}

function sseResult(content: unknown): string {
  return `data: ${JSON.stringify({
    result: { content: [{ text: JSON.stringify(content) }] },
  })}\n`;
}

function primeSession(): void {
  mockFetch.mockResolvedValueOnce(
    makeFetchResponse('', { 'mcp-session-id': SESSION_ID }),
  );
  mockFetch.mockResolvedValueOnce(makeFetchResponse(''));
}

describe('commitPlannedEvents', () => {
  beforeEach(() => {
    process.env.WIZARD_LLM_PROXY_URL = PROXY_BASE;
    mockAxiosPost.mockReset();
    mockFetch.mockReset();
    mockQuery.mockReset();
    _clearMcpSessionCacheForTesting();
    mockAxiosPost.mockResolvedValue({
      status: 200,
      data: {
        createdCount: 1,
        eventTypes: ['Button Clicked'],
        appId: '12345',
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.WIZARD_LLM_PROXY_URL;
  });

  it('returns zero counts and does not call HTTP or MCP when events are empty', async () => {
    const result = await commitPlannedEvents({
      accessToken: 'tok',
      appId: '12345',
      events: [],
      zone: 'us',
    });

    expect(result).toEqual({ attempted: 0, created: 0, described: 0 });
    expect(mockAxiosPost).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns zero counts when appId is missing', async () => {
    const result = await commitPlannedEvents({
      accessToken: 'tok',
      appId: '',
      events: [{ name: 'Button Clicked', description: '' }],
      zone: 'us',
    });

    expect(result).toEqual({ attempted: 0, created: 0, described: 0 });
    expect(mockAxiosPost).not.toHaveBeenCalled();
  });

  it('POSTs planned-events with wasPlanned: true and appId', async () => {
    mockAxiosPost.mockResolvedValueOnce({
      status: 200,
      data: {
        createdCount: 1,
        eventTypes: ['Button Clicked'],
        appId: '12345',
      },
    });

    const result = await commitPlannedEvents({
      accessToken: 'tok',
      appId: '12345',
      events: [{ name: 'Button Clicked', description: '' }],
      zone: 'us',
    });

    expect(result.created).toBe(1);
    expect(result.attempted).toBe(1);
    expect(result.described).toBe(0);

    expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    const [url, body, config] = mockAxiosPost.mock.calls[0];
    expect(String(url)).toBe(`${PROXY_BASE}/v1/planned-events`);
    expect(body).toEqual({
      appId: '12345',
      events: [{ eventType: 'Button Clicked', wasPlanned: true }],
    });
    expect(config.headers.Authorization).toBe('Bearer tok');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('follows up with update_event when descriptions are present', async () => {
    mockAxiosPost.mockResolvedValueOnce({
      status: 200,
      data: {
        createdCount: 1,
        eventTypes: ['Sign Up Completed'],
        appId: '12345',
      },
    });
    primeSession();
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse(sseResult({ success: true })),
    );

    const result = await commitPlannedEvents({
      accessToken: 'tok',
      appId: '12345',
      events: [
        { name: 'Sign Up Completed', description: 'Fired when signup ends' },
      ],
      zone: 'us',
    });

    expect(result).toEqual({ attempted: 1, created: 1, described: 1 });

    const updateCall = mockFetch.mock.calls.find(
      ([, init]) =>
        typeof (init as { body?: string })?.body === 'string' &&
        (init as { body: string }).body.includes('update_event'),
    );
    expect(updateCall).toBeTruthy();
    const reqBody = JSON.parse((updateCall![1] as { body: string }).body);
    expect(reqBody.params.arguments.descriptions).toEqual({
      'Sign Up Completed': 'Fired when signup ends',
    });
  });

  it('deduplicates events by name and trims whitespace', async () => {
    mockAxiosPost.mockResolvedValueOnce({
      status: 200,
      data: {
        createdCount: 1,
        eventTypes: ['Button Clicked'],
        appId: '12345',
      },
    });

    const result = await commitPlannedEvents({
      accessToken: 'tok',
      appId: '12345',
      events: [
        { name: '  Button Clicked  ', description: '' },
        { name: 'Button Clicked', description: '' },
        { name: '', description: 'no name' },
      ],
      zone: 'us',
    });

    expect(result.attempted).toBe(1);
    const [, body] = mockAxiosPost.mock.calls[0];
    expect(body).toEqual({
      appId: '12345',
      events: [{ eventType: 'Button Clicked', wasPlanned: true }],
    });
  });

  it('returns an error message when planned-events HTTP reports failure', async () => {
    mockAxiosPost.mockResolvedValueOnce({
      status: 403,
      data: {
        error: { code: 'APP_NOT_IN_ORG', message: 'App not in org' },
      },
    });

    const result = await commitPlannedEvents({
      accessToken: 'tok',
      appId: '12345',
      events: [{ name: 'Button Clicked', description: '' }],
      zone: 'us',
    });

    expect(result.created).toBe(0);
    expect(result.error).toBe('APP_NOT_IN_ORG: App not in org');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('treats the full 2xx range as success, including 201 and 299', async () => {
    // The HTTP success classifier is `>= 200 && < 300`. An off-by-one
    // (`< 299`) would silently misroute 299s as errors, and a flip to
    // `<= 300` would treat a 300-redirect as event creation. Pin the
    // boundary explicitly: a happy 201 and a happy 299 both succeed.
    for (const status of [201, 299]) {
      mockAxiosPost.mockResolvedValueOnce({
        status,
        data: {
          createdCount: 1,
          eventTypes: ['Boundary'],
          appId: '12345',
        },
      });
      const result = await commitPlannedEvents({
        accessToken: 'tok',
        appId: '12345',
        events: [{ name: 'Boundary', description: '' }],
        zone: 'us',
      });
      expect(result.created, `status ${status} should succeed`).toBe(1);
      expect(result.error).toBeUndefined();
    }
  });

  it('treats 300 (and beyond) as a failure — routes to the error branch with REDIRECT', async () => {
    // Counter-pin: 300 is NOT success. A `<= 300` mutation would flip
    // this and silently mark redirects as event creation. Also: an
    // earlier draft of this test slipped through `<= 300` because the
    // response body's mismatched shape caused a generic "Invalid
    // response" error from the success branch — same pass/fail surface
    // as the real error branch. We pin the exact error code so that
    // semantic difference is visible.
    mockAxiosPost.mockResolvedValueOnce({
      status: 300,
      data: { error: { code: 'REDIRECT', message: 'redirected' } },
    });
    const result = await commitPlannedEvents({
      accessToken: 'tok',
      appId: '12345',
      events: [{ name: 'X', description: '' }],
      zone: 'us',
    });
    expect(result.created).toBe(0);
    // Error code REDIRECT comes from the failure-branch parser (which
    // reads `data.error.code`). The success branch can't produce this
    // string — if `<= 300` slips in, the message becomes "Invalid
    // response from planned-events endpoint" instead.
    expect(result.error).toContain('REDIRECT');
  });

  it('maps CONFLICT from planned-events HTTP response', async () => {
    mockAxiosPost.mockResolvedValueOnce({
      status: 409,
      data: {
        error: {
          code: 'CONFLICT',
          message: 'One or more event types already exist on the tracking plan',
        },
      },
    });

    const result = await commitPlannedEvents({
      accessToken: 'tok',
      appId: '12345',
      events: [{ name: 'Dup', description: '' }],
      zone: 'us',
    });

    expect(result.created).toBe(0);
    expect(result.error).toContain('CONFLICT');
  });

  // Regression — prevents the "MCP server doesn't expose create_events"
  // failure mode from spinning up a 20s Claude-agent fallback. HTTP 404
  // triggers MCP fallback; MCP returns plain "MCP error" text; we short-circuit.
  it('short-circuits without an agent fallback when MCP returns "MCP error"', async () => {
    mockAxiosPost.mockResolvedValueOnce({ status: 404, data: {} });
    primeSession();
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse(
        `data: ${JSON.stringify({
          result: {
            content: [
              {
                text: 'MCP error: tool create_events is not implemented in this category',
              },
            ],
          },
        })}\n`,
      ),
    );

    const result = await commitPlannedEvents({
      accessToken: 'tok',
      appId: '12345',
      events: [{ name: 'Button Clicked', description: 'fired on click' }],
      zone: 'us',
    });

    expect(result.attempted).toBe(1);
    expect(result.created).toBe(0);
    expect(result.described).toBe(0);
    expect(result.error).toContain('not available');

    expect(mockQuery).not.toHaveBeenCalled();
  });
});
