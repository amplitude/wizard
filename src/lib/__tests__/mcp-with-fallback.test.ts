import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  callAmplitudeMcp,
  AMPLITUDE_MCP_URL,
  _clearMcpSessionCacheForTesting,
  invalidateMcpSessionsForToken,
} from '../mcp-with-fallback';

vi.mock('../../utils/debug');

// ── fetch mock ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

/** Build a minimal fetch Response with headers and a readable body. */
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

/** Encode a JSON-RPC result as an SSE data line. */
function sseResult(content: unknown): string {
  return `data: ${JSON.stringify({
    result: { content: [{ text: JSON.stringify(content) }] },
  })}\n`;
}

/** Encode a JSON-RPC error as an SSE data line. */
function sseError(code: number, message: string): string {
  return `data: ${JSON.stringify({ error: { code, message } })}\n`;
}

// ── SDK mock ──────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const SESSION_ID = 'test-session-id';

function setupSuccessfulMcpSession(): void {
  // initialize → returns session id
  mockFetch.mockResolvedValueOnce(
    makeFetchResponse('', { 'mcp-session-id': SESSION_ID }),
  );
  // notifications/initialized (fire-and-forget)
  mockFetch.mockResolvedValueOnce(makeFetchResponse(''));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('callAmplitudeMcp', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockQuery.mockReset();
    // Clear the in-process MCP session cache so a session opened by a
    // previous test (different mockFetch sequence) doesn't get reused
    // here. Real callers benefit from the cache; tests must isolate.
    _clearMcpSessionCacheForTesting();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('direct path succeeds', () => {
    it('returns the direct result without touching the agent', async () => {
      setupSuccessfulMcpSession();
      // tools/call response
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse(sseResult({ value: 42 })),
      );

      const result = await callAmplitudeMcp({
        accessToken: 'tok',
        direct: async (callTool) => {
          const text = await callTool(1, 'some_tool', {});
          return text ? (JSON.parse(text) as { value: number }) : null;
        },
        agentPrompt: 'unused',
        parseAgent: () => null,
      });

      expect(result).toEqual({ value: 42 });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('uses the default MCP URL when none is provided', async () => {
      setupSuccessfulMcpSession();
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse(sseResult({ ok: true })),
      );

      await callAmplitudeMcp({
        accessToken: 'tok',
        direct: async (callTool) => {
          await callTool(1, 't', {});
          return 'done';
        },
        agentPrompt: 'p',
        parseAgent: () => null,
      });

      // The initialize call should have gone to AMPLITUDE_MCP_URL
      expect(mockFetch).toHaveBeenCalledWith(
        AMPLITUDE_MCP_URL,
        expect.anything(),
      );
    });

    it('uses a custom mcpUrl when provided', async () => {
      const customUrl = 'http://localhost:9999/mcp';
      setupSuccessfulMcpSession();
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse(sseResult({ ok: true })),
      );

      await callAmplitudeMcp({
        accessToken: 'tok',
        mcpUrl: customUrl,
        direct: async (callTool) => {
          await callTool(1, 't', {});
          return 'done';
        },
        agentPrompt: 'p',
        parseAgent: () => null,
      });

      expect(mockFetch).toHaveBeenCalledWith(customUrl, expect.anything());
    });
  });

  describe('falls back to agent when direct returns null', () => {
    it('calls the agent and passes output to parseAgent', async () => {
      setupSuccessfulMcpSession();
      // callTool returns null (e.g. tool not found)
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse(sseError(-32602, 'Tool not found')),
      );

      const agentOutput = '{"value":99}';
      mockQuery.mockReturnValue(
        (async function* () {
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: agentOutput }] },
          };
        })(),
      );

      const result = await callAmplitudeMcp({
        accessToken: 'tok',
        direct: async (callTool) => {
          const text = await callTool(1, 'missing_tool', {});
          return text ? (JSON.parse(text) as { value: number }) : null;
        },
        agentPrompt: 'Check the project',
        parseAgent: (text) => {
          const m = text.match(/\{.*\}/s);
          return m ? (JSON.parse(m[0]) as { value: number }) : null;
        },
      });

      expect(mockQuery).toHaveBeenCalledOnce();
      expect(result).toEqual({ value: 99 });
    });

    it('passes the agentPrompt to the SDK query', async () => {
      setupSuccessfulMcpSession();
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse(sseError(-32602, 'nope')),
      );

      mockQuery.mockReturnValue(
        (async function* () {
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: '{"done":true}' }] },
          };
        })(),
      );

      await callAmplitudeMcp({
        accessToken: 'tok',
        direct: async () => null,
        agentPrompt: 'My special prompt',
        parseAgent: () => ({ done: true }),
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'My special prompt' }),
      );
    });

    it('configures the agent with only the Amplitude MCP server', async () => {
      setupSuccessfulMcpSession();
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse(sseError(-32602, 'nope')),
      );

      mockQuery.mockReturnValue((async function* () {})());

      await callAmplitudeMcp({
        accessToken: 'mytoken',
        direct: async (callTool) => {
          await callTool(1, 'gone', {});
          return null;
        },
        agentPrompt: 'p',
        parseAgent: () => null,
      });

      const callArgs = mockQuery.mock.calls[0][0] as {
        options: {
          mcpServers: Record<string, unknown>;
          allowedTools: unknown[];
        };
      };
      expect(callArgs.options.allowedTools).toEqual([]);
      expect(callArgs.options.mcpServers).toHaveProperty('amplitude');
      expect(
        (
          callArgs.options.mcpServers.amplitude as {
            headers: Record<string, string>;
          }
        ).headers,
      ).toMatchObject({ Authorization: 'Bearer mytoken' });
    });
  });

  describe('falls back to agent when direct throws', () => {
    it('triggers fallback on exception from the direct callback', async () => {
      setupSuccessfulMcpSession();

      mockQuery.mockReturnValue(
        (async function* () {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: '{"recovered":true}' }],
            },
          };
        })(),
      );

      const result = await callAmplitudeMcp({
        accessToken: 'tok',
        direct: async () => {
          throw new Error('parse exploded');
        },
        agentPrompt: 'recover',
        parseAgent: (text) => {
          const m = text.match(/\{.*\}/s);
          return m ? (JSON.parse(m[0]) as { recovered: boolean }) : null;
        },
      });

      expect(mockQuery).toHaveBeenCalledOnce();
      expect(result).toEqual({ recovered: true });
    });
  });

  describe('MCP session failure', () => {
    it('goes straight to agent fallback when initialize fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network error'));

      mockQuery.mockReturnValue(
        (async function* () {
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: '{"ok":true}' }] },
          };
        })(),
      );

      const result = await callAmplitudeMcp({
        accessToken: 'tok',
        direct: async () => ({ ok: false }),
        agentPrompt: 'fallback',
        parseAgent: (text) => {
          const m = text.match(/\{.*\}/s);
          return m ? (JSON.parse(m[0]) as { ok: boolean }) : null;
        },
      });

      // direct was skipped because session failed; agent ran
      expect(mockQuery).toHaveBeenCalledOnce();
      expect(result).toEqual({ ok: true });
    });

    it('returns null when initialize returns no session id', async () => {
      // no mcp-session-id header
      mockFetch.mockResolvedValueOnce(makeFetchResponse('', {}));

      mockQuery.mockReturnValue(
        (async function* () {
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'nothing parseable' }] },
          };
        })(),
      );

      const result = await callAmplitudeMcp({
        accessToken: 'tok',
        direct: async () => 'should not reach',
        agentPrompt: 'p',
        parseAgent: () => null,
      });

      expect(result).toBeNull();
    });
  });

  describe('both paths fail', () => {
    it('returns null when agent produces no parseable output', async () => {
      setupSuccessfulMcpSession();
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse(sseError(-32602, 'gone')),
      );

      mockQuery.mockReturnValue(
        (async function* () {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'I could not find any data.' }],
            },
          };
        })(),
      );

      const result = await callAmplitudeMcp({
        accessToken: 'tok',
        direct: async (callTool) => {
          const text = await callTool(1, 'tool', {});
          return text ?? null;
        },
        agentPrompt: 'p',
        parseAgent: () => null,
      });

      expect(result).toBeNull();
    });
  });

  describe('abortSignal', () => {
    it('threads the signal into fetch calls', async () => {
      const controller = new AbortController();
      setupSuccessfulMcpSession();
      mockFetch.mockResolvedValueOnce(makeFetchResponse(sseResult({ v: 1 })));

      await callAmplitudeMcp({
        accessToken: 'tok',
        abortSignal: controller.signal,
        direct: async (callTool) => {
          const text = await callTool(1, 't', {});
          return text ? JSON.parse(text) : null;
        },
        agentPrompt: 'p',
        parseAgent: () => null,
      });

      // All three fetch calls (initialize, notifications/initialized, tools/call)
      // should have received the signal
      for (const [, opts] of mockFetch.mock.calls) {
        expect((opts as Record<string, unknown>).signal).toBe(
          controller.signal,
        );
      }
    });

    it('propagates abort to the agent fallback', async () => {
      const controller = new AbortController();
      setupSuccessfulMcpSession();
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse(sseError(-32602, 'gone')),
      );

      let capturedSignal: AbortSignal | undefined;
      // Two separate gates: one to know the generator started, one to hold it open
      let signalRunning!: () => void;
      const generatorRunning = new Promise<void>((res) => {
        signalRunning = res;
      });
      let releaseGenerator!: () => void;
      const generatorGate = new Promise<void>((res) => {
        releaseGenerator = res;
      });

      mockQuery.mockImplementation(
        (args: { options: { abortSignal?: AbortSignal } }) => {
          capturedSignal = args.options?.abortSignal;
          return (async function* (): AsyncGenerator<unknown> {
            signalRunning(); // tell the test we're parked inside the generator
            await generatorGate; // hold until the test releases us
            yield; // satisfy require-yield (never reached)
          })();
        },
      );

      // Start without awaiting so we can interact while the generator is parked
      const callPromise = callAmplitudeMcp({
        accessToken: 'tok',
        abortSignal: controller.signal,
        direct: async (callTool) => {
          await callTool(1, 'gone', {});
          return null;
        },
        agentPrompt: 'p',
        parseAgent: () => null,
      });

      // Wait until the generator has started and capturedSignal is set
      await generatorRunning;

      expect(capturedSignal).toBeDefined();
      expect(capturedSignal?.aborted).toBe(false);

      // Abort the external signal while the generator is still running
      controller.abort();
      expect(capturedSignal?.aborted).toBe(true);

      // Release the generator so the call can finish
      releaseGenerator();
      await callPromise;
    });

    it('forces a fresh handshake after invalidateMcpSessionsForToken', async () => {
      // First call: full handshake (initialize, notifications/initialized,
      // tools/call) seeds the cache.
      setupSuccessfulMcpSession();
      mockFetch.mockResolvedValueOnce(makeFetchResponse(sseResult({ v: 1 })));
      await callAmplitudeMcp({
        accessToken: 'old-tok',
        direct: async (callTool) => {
          const text = await callTool(1, 't', {});
          return text ? JSON.parse(text) : null;
        },
        agentPrompt: 'p',
        parseAgent: () => null,
      });

      // Drop cached sessions bound to the now-stale token (mirrors what
      // refreshTokenIfStale does after rotating the bearer).
      invalidateMcpSessionsForToken('old-tok');

      // Second call with the SAME token: should re-handshake (3 fetches),
      // not reuse the dropped session (which would have been 1 fetch).
      mockFetch.mockReset();
      setupSuccessfulMcpSession();
      mockFetch.mockResolvedValueOnce(makeFetchResponse(sseResult({ v: 2 })));
      await callAmplitudeMcp({
        accessToken: 'old-tok',
        direct: async (callTool) => {
          const text = await callTool(1, 't', {});
          return text ? JSON.parse(text) : null;
        },
        agentPrompt: 'p',
        parseAgent: () => null,
      });

      expect(mockFetch.mock.calls.length).toBe(3);
    });

    it('defaults to the wizard-wide abort signal when none is provided', async () => {
      const { resetWizardAbortController } = await import(
        '../../utils/wizard-abort'
      );
      resetWizardAbortController();

      setupSuccessfulMcpSession();
      mockFetch.mockResolvedValueOnce(makeFetchResponse(sseResult({ v: 1 })));

      await callAmplitudeMcp({
        accessToken: 'tok',
        // intentionally no abortSignal — should default to wizard signal
        direct: async (callTool) => {
          const text = await callTool(1, 't', {});
          return text ? JSON.parse(text) : null;
        },
        agentPrompt: 'p',
        parseAgent: () => null,
      });

      const { getWizardAbortSignal } = await import('../../utils/wizard-abort');
      const wizardSignal = getWizardAbortSignal();
      // Every fetch call should have received the wizard signal.
      for (const [, opts] of mockFetch.mock.calls) {
        expect((opts as Record<string, unknown>).signal).toBe(wizardSignal);
      }
    });
  });
});
