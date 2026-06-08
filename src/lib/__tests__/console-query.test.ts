import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the SDK BEFORE importing the module under test, otherwise the dynamic
// import inside queryConsole resolves to the real package.
const mockQuery = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

const mockStreamText = vi.fn();
vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
}));

const mockCreateAnthropic = vi.fn();
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: (opts: unknown) => mockCreateAnthropic(opts),
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

import {
  queryConsole,
  resolveConsoleCredentials,
  type ConsoleCredentials,
} from '../console-query.js';
import { getAgent } from '../agent-interface.js';
import type { WizardSession } from '../wizard-session.js';
import { toCredentialAppId } from '../wizard-session.js';

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
    useLocalClaude: false,
    wizardFlags: {},
    wizardMetadata: {},
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

function fakeTextStream(parts: string[]): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const p of parts) yield p;
    },
  };
}

describe('queryConsole — Agent Analytics session header', () => {
  beforeEach(() => {
    delete process.env.AMPLITUDE_WIZARD_AI_SDK_CONSOLE;
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

describe('queryConsole — Vercel AI SDK path (AMPLITUDE_WIZARD_AI_SDK_CONSOLE)', () => {
  beforeEach(() => {
    process.env.AMPLITUDE_WIZARD_AI_SDK_CONSOLE = '1';
    mockQuery.mockReset();
    mockStreamText.mockReset();
    mockCreateAnthropic.mockReset();
    vi.mocked(getAgent).mockReset();

    const providerModel = vi.fn((model: string) => `resolved:${model}`);
    mockCreateAnthropic.mockReturnValue(providerModel);
    mockStreamText.mockReturnValue({
      textStream: fakeTextStream(['hello', ' world']),
    });
  });

  afterEach(() => {
    delete process.env.AMPLITUDE_WIZARD_AI_SDK_CONSOLE;
  });

  it('uses streamText + createAnthropic headers instead of claude-agent-sdk query()', async () => {
    vi.mocked(getAgent).mockResolvedValue(fakeAgentConfig(TEST_SESSION_ID));

    const out = await queryConsole('ping', 'system ctx', CREDS);

    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockCreateAnthropic).toHaveBeenCalledTimes(1);
    const anthropicOpts = mockCreateAnthropic.mock.calls[0][0] as {
      headers: Record<string, string>;
    };
    expect(anthropicOpts.headers['x-amp-wizard-session-id']).toBe(
      TEST_SESSION_ID,
    );

    expect(mockStreamText).toHaveBeenCalledTimes(1);
    const stArgs = mockStreamText.mock.calls[0][0] as {
      system: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(stArgs.system).toContain('system ctx');
    expect(stArgs.messages[0].content).toBe('ping');

    expect(out).toBe('hello world');
  });

  it('falls back to Agent SDK when useLocalClaude is true', async () => {
    vi.mocked(getAgent).mockResolvedValue({
      ...fakeAgentConfig(TEST_SESSION_ID),
      useLocalClaude: true,
    });
    mockQuery.mockReturnValue(fakeStream('local'));

    const out = await queryConsole('ping', 'ctx', CREDS);

    expect(mockStreamText).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalled();
    expect(out).toBe('local');
  });

  it('forwards a /v1-suffixed baseURL to createAnthropic so the AI SDK posts to …/wizard/v1/messages', async () => {
    vi.mocked(getAgent).mockResolvedValue(fakeAgentConfig(TEST_SESSION_ID));
    const prior = process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = 'https://core.amplitude.com/wizard';

    try {
      await queryConsole('ping', 'ctx', CREDS);

      expect(mockCreateAnthropic).toHaveBeenCalledTimes(1);
      const opts = mockCreateAnthropic.mock.calls[0][0] as {
        baseURL?: string;
      };
      expect(opts.baseURL).toBe('https://core.amplitude.com/wizard/v1');
    } finally {
      if (prior === undefined) {
        delete process.env.ANTHROPIC_BASE_URL;
      } else {
        process.env.ANTHROPIC_BASE_URL = prior;
      }
    }
  });

  // Regression: BA-296 — `resolveConsoleCredentials` used to return a usable
  // `kind: 'gateway'` envelope as long as the session had a `projectApiKey`
  // and a `host`. The AuthScreen [M] pre-OAuth manual-fallback path leaves
  // `credentials.accessToken === ''` (no browser auth yet), so the user could
  // press Tab to ask a question, the call would route through
  // `queryConsoleWithClaudeAgentSdk`, `initializeAgent` would fall through to
  // the local-claude CLI path (`useLocalClaude = !bearerToken && !direct`),
  // and the Claude Code SDK would surface "There's an issue with the
  // selected model (anthropic/claude-sonnet-4-6). It may not exist or you
  // may not have access to it." Guard the gate so the user instead sees the
  // friendly "Claude is not available yet — complete authentication first."
  it('returns kind=none when session credentials are present but the OAuth access token is empty (BA-296 manual-fallback path)', () => {
    const session = {
      credentials: {
        accessToken: '',
        projectApiKey: '15d5e106e8447c5faf2d5b1ff3f66dd9',
        host: 'https://api2.amplitude.com',
        appId: toCredentialAppId(null),
      },
    } as unknown as WizardSession;

    const prior = {
      base: process.env.ANTHROPIC_BASE_URL,
      auth: process.env.ANTHROPIC_AUTH_TOKEN,
      direct: process.env.ANTHROPIC_API_KEY,
    };
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      expect(resolveConsoleCredentials(session)).toEqual({ kind: 'none' });
    } finally {
      if (prior.base !== undefined) process.env.ANTHROPIC_BASE_URL = prior.base;
      if (prior.auth !== undefined)
        process.env.ANTHROPIC_AUTH_TOKEN = prior.auth;
      if (prior.direct !== undefined)
        process.env.ANTHROPIC_API_KEY = prior.direct;
    }
  });

  it('returns kind=gateway when session credentials have a non-empty access token', () => {
    const session = {
      credentials: {
        accessToken: 'amplitude-bearer-token',
        projectApiKey: 'project-key',
        host: 'https://api2.amplitude.com',
        appId: toCredentialAppId(null),
      },
    } as unknown as WizardSession;

    const prior = {
      base: process.env.ANTHROPIC_BASE_URL,
      auth: process.env.ANTHROPIC_AUTH_TOKEN,
    };
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_AUTH_TOKEN;

    try {
      const result = resolveConsoleCredentials(session);
      expect(result.kind).toBe('gateway');
    } finally {
      if (prior.base !== undefined) process.env.ANTHROPIC_BASE_URL = prior.base;
      if (prior.auth !== undefined)
        process.env.ANTHROPIC_AUTH_TOKEN = prior.auth;
    }
  });

  it('leaves an already /v1-suffixed ANTHROPIC_BASE_URL untouched (idempotent)', async () => {
    vi.mocked(getAgent).mockResolvedValue(fakeAgentConfig(TEST_SESSION_ID));
    const prior = process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = 'https://core.amplitude.com/wizard/v1';

    try {
      await queryConsole('ping', 'ctx', CREDS);

      const opts = mockCreateAnthropic.mock.calls[0][0] as {
        baseURL?: string;
      };
      expect(opts.baseURL).toBe('https://core.amplitude.com/wizard/v1');
    } finally {
      if (prior === undefined) {
        delete process.env.ANTHROPIC_BASE_URL;
      } else {
        process.env.ANTHROPIC_BASE_URL = prior;
      }
    }
  });
});
