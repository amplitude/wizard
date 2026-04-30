import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { commitPlannedEvents } from '../planned-events';
import { _clearMcpSessionCacheForTesting } from '../mcp-with-fallback';

vi.mock('../../utils/debug');

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockQuery = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

const SESSION_ID = 'test-session-id';

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
  // initialize
  mockFetch.mockResolvedValueOnce(
    makeFetchResponse('', { 'mcp-session-id': SESSION_ID }),
  );
  // notifications/initialized
  mockFetch.mockResolvedValueOnce(makeFetchResponse(''));
}

describe('commitPlannedEvents', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockQuery.mockReset();
    // Clear the mcp-with-fallback session cache so a session opened by
    // a prior test (different mockFetch sequence) doesn't get reused.
    _clearMcpSessionCacheForTesting();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns zero counts and does not call MCP when events are empty', async () => {
    const result = await commitPlannedEvents({
      accessToken: 'tok',
      appId: '12345',
      events: [],
    });

    expect(result).toEqual({ attempted: 0, created: 0, described: 0 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns zero counts when appId is missing', async () => {
    const result = await commitPlannedEvents({
      accessToken: 'tok',
      appId: '',
      events: [{ name: 'Button Clicked', description: '' }],
    });

    expect(result).toEqual({ attempted: 0, created: 0, described: 0 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calls create_events with wasPlanned: true and project id', async () => {
    primeSession();
    // create_events response
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse(
        sseResult({
          success: true,
          createdEvents: ['Button Clicked'],
          message: 'ok',
        }),
      ),
    );

    const result = await commitPlannedEvents({
      accessToken: 'tok',
      appId: '12345',
      events: [{ name: 'Button Clicked', description: '' }],
    });

    expect(result.created).toBe(1);
    expect(result.attempted).toBe(1);
    expect(result.described).toBe(0);

    // Inspect the create_events request body
    const createCall = mockFetch.mock.calls.find(
      ([, init]) =>
        typeof (init as { body?: string })?.body === 'string' &&
        (init as { body: string }).body.includes('tools/call'),
    );
    expect(createCall).toBeTruthy();
    const body = JSON.parse((createCall![1] as { body: string }).body);
    expect(body.params.name).toBe('create_events');
    expect(body.params.arguments.projectId).toBe('12345');
    expect(body.params.arguments.events).toEqual([
      { eventType: 'Button Clicked', wasPlanned: true },
    ]);
  });

  it('follows up with update_event when descriptions are present', async () => {
    primeSession();
    // create_events
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse(
        sseResult({
          success: true,
          createdEvents: ['Sign Up Completed'],
        }),
      ),
    );
    // update_event reuses the cached session opened above (no second
    // initialize round-trip thanks to the in-process MCP session
    // cache). Just queue the tools/call response.
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse(sseResult({ success: true })),
    );

    const result = await commitPlannedEvents({
      accessToken: 'tok',
      appId: '12345',
      events: [
        { name: 'Sign Up Completed', description: 'Fired when signup ends' },
      ],
    });

    expect(result).toEqual({ attempted: 1, created: 1, described: 1 });

    const updateCall = mockFetch.mock.calls.find(
      ([, init]) =>
        typeof (init as { body?: string })?.body === 'string' &&
        (init as { body: string }).body.includes('update_event'),
    );
    expect(updateCall).toBeTruthy();
    const body = JSON.parse((updateCall![1] as { body: string }).body);
    expect(body.params.arguments.descriptions).toEqual({
      'Sign Up Completed': 'Fired when signup ends',
    });
  });

  it('deduplicates events by name and trims whitespace', async () => {
    primeSession();
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse(
        sseResult({
          success: true,
          createdEvents: ['Button Clicked'],
        }),
      ),
    );

    const result = await commitPlannedEvents({
      accessToken: 'tok',
      appId: '12345',
      events: [
        { name: '  Button Clicked  ', description: '' },
        { name: 'Button Clicked', description: '' },
        { name: '', description: 'no name' },
      ],
    });

    expect(result.attempted).toBe(1);
    const createCall = mockFetch.mock.calls.find(
      ([, init]) =>
        typeof (init as { body?: string })?.body === 'string' &&
        (init as { body: string }).body.includes('create_events'),
    );
    const body = JSON.parse((createCall![1] as { body: string }).body);
    expect(body.params.arguments.events).toEqual([
      { eventType: 'Button Clicked', wasPlanned: true },
    ]);
  });

  it('returns an error message when create_events reports failure', async () => {
    primeSession();
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse(
        sseResult({ success: false, message: 'permission denied' }),
      ),
    );
    // Agent fallback also returns failure
    mockQuery.mockReturnValue(
      (async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'text',
                text: '{"success":false,"message":"permission denied"}',
              },
            ],
          },
        };
      })(),
    );

    const result = await commitPlannedEvents({
      accessToken: 'tok',
      appId: '12345',
      events: [{ name: 'Button Clicked', description: '' }],
    });

    expect(result.created).toBe(0);
    expect(result.error).toBe('permission denied');
  });

  // Regression — prevents the "MCP server doesn't expose create_events"
  // failure mode (visible across every successful instrumentation run in
  // ~/.amplitude/wizard/runs/*/log.txt) from spinning up a 20s Claude-agent
  // fallback that confirms the same conclusion. The MCP tool returns a
  // string body that begins with "MCP error" when its underlying handler
  // throws; we treat that as "tool not implemented" and short-circuit.
  it('short-circuits without an agent fallback when MCP returns "MCP error"', async () => {
    primeSession();
    // create_events returns plain "MCP error: ..." text inside content[0].text
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
    });

    expect(result.attempted).toBe(1);
    expect(result.created).toBe(0);
    expect(result.described).toBe(0);
    expect(result.error).toContain('not available');

    // Critical: no agent SDK call. The whole point of this fix is to skip
    // the 20s Claude fallback that ends in the same place.
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
