import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the SDK BEFORE importing the module under test, otherwise the dynamic
// import inside queryConsole resolves to the real package.
const mockQuery = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// queryConsole calls getAgent() to read the cached AgentRunConfig — stub it so
// the test doesn't need a real LLM gateway / OAuth token / MCP server.
vi.mock('../agent-interface.js', async () => {
  const actual = await vi.importActual<typeof import('../agent-interface.js')>(
    '../agent-interface.js',
  );
  return {
    ...actual,
    getAgent: vi.fn(),
  };
});

import { queryConsole, type ConsoleCredentials } from '../console-query.js';
import { getAgent } from '../agent-interface.js';

const TEST_SESSION_ID = '550e8400-e29b-41d4-a716-446655440000';

const CREDS: ConsoleCredentials = {
  kind: 'gateway',
  baseUrl: 'https://api.amplitude.com/llm-proxy',
  apiKey: 'test-token',
};

function fakeAgentConfig(agentSessionId?: string) {
  return {
    workingDirectory: '/tmp',
    mcpServers: {},
    model: 'anthropic/claude-sonnet-4-6',
    agentSessionId,
  };
}

// Minimal async iterable that yields one assistant text block, mimicking the
// shape `safeParseSDKMessage` accepts.
function fakeStream(text: string): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text }] },
      };
    },
  };
}

describe('queryConsole — Agent Analytics session header', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockReturnValue(fakeStream('hi'));
    vi.mocked(getAgent).mockReset();
  });

  it('forwards x-amp-wizard-session-id from the cached AgentRunConfig so slash-prompt LLM calls land in the same Agent Analytics session as the main run', async () => {
    vi.mocked(getAgent).mockResolvedValue(fakeAgentConfig(TEST_SESSION_ID));

    await queryConsole('what is amplitude?', 'context', CREDS);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const callArgs = mockQuery.mock.calls[0][0] as {
      options: { env: Record<string, string | undefined> };
    };
    const customHeaders = callArgs.options.env.ANTHROPIC_CUSTOM_HEADERS ?? '';

    expect(customHeaders).toContain(
      `x-amp-wizard-session-id: ${TEST_SESSION_ID}`,
    );
  });

  it('omits the session header when the cached config has no session id (defensive — should never happen in production)', async () => {
    vi.mocked(getAgent).mockResolvedValue(fakeAgentConfig(undefined));

    await queryConsole('what is amplitude?', 'context', CREDS);

    const callArgs = mockQuery.mock.calls[0][0] as {
      options: { env: Record<string, string | undefined> };
    };
    const customHeaders = callArgs.options.env.ANTHROPIC_CUSTOM_HEADERS ?? '';

    expect(customHeaders).not.toContain('x-amp-wizard-session-id');
  });

  it('preserves process.env values alongside the custom headers (does not stomp inherited env)', async () => {
    vi.mocked(getAgent).mockResolvedValue(fakeAgentConfig(TEST_SESSION_ID));
    const sentinel = 'sentinel-value';
    const prior = process.env.WIZARD_TEST_SENTINEL;
    process.env.WIZARD_TEST_SENTINEL = sentinel;

    try {
      await queryConsole('what is amplitude?', 'context', CREDS);

      const callArgs = mockQuery.mock.calls[0][0] as {
        options: { env: Record<string, string | undefined> };
      };
      expect(callArgs.options.env.WIZARD_TEST_SENTINEL).toBe(sentinel);
    } finally {
      if (prior === undefined) {
        delete process.env.WIZARD_TEST_SENTINEL;
      } else {
        process.env.WIZARD_TEST_SENTINEL = prior;
      }
    }
  });

  it('returns the early-exit message without calling query() when credentials are missing', async () => {
    const result = await queryConsole('what is amplitude?', 'context', {
      kind: 'none',
    });

    expect(result).toContain('not available yet');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
