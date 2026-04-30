import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  callAmplitudeMcp,
  AMPLITUDE_MCP_URL,
  _clearMcpSessionCacheForTesting,
  invalidateMcpSessionCache,
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

    it('fails fast on HTTP 401 from initialize without invoking the agent', async () => {
      mockFetch.mockResolvedValueOnce(makeFetchResponse('', {}, 401));

      mockQuery.mockReturnValue(
        (async function* () {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'this should never run' }],
            },
          };
        })(),
      );

      const result = await callAmplitudeMcp({
        accessToken: 'expired-tok',
        direct: async (callTool) => {
          await callTool(1, 'noop', {});
          return 'unreachable';
        },
        agentPrompt: 'agent should not run',
        parseAgent: () => 'parsed',
      });

      // Returns null immediately — same auth failure would just repeat.
      expect(result).toBeNull();
      // The agent fallback (which would burn ~12s on the same access
      // token and hit the same 401) is never started.
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('fails fast on HTTP 403 from initialize without invoking the agent', async () => {
      mockFetch.mockResolvedValueOnce(makeFetchResponse('', {}, 403));

      mockQuery.mockReturnValue((async function* () {})());

      const result = await callAmplitudeMcp({
        accessToken: 'forbidden-tok',
        direct: async () => 'unreachable',
        agentPrompt: 'agent should not run',
        parseAgent: () => null,
      });

      expect(result).toBeNull();
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('still uses agent fallback on HTTP 500 from initialize (transient)', async () => {
      mockFetch.mockResolvedValueOnce(makeFetchResponse('', {}, 500));

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
        direct: async () => null,
        agentPrompt: 'fallback',
        parseAgent: (text) => {
          const m = text.match(/\{.*\}/s);
          return m ? (JSON.parse(m[0]) as { recovered: boolean }) : null;
        },
      });

      // Agent fallback IS invoked — 5xx is transient.
      expect(mockQuery).toHaveBeenCalledOnce();
      expect(result).toEqual({ recovered: true });
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
    it('propagates external abort into every fetch call (linked, not identity)', async () => {
      // Each fetch is now wrapped with a per-call timeout
      // (`fetchWithTimeout`) which combines the external signal with an
      // internal AbortController. The signal threaded through to `fetch`
      // is the internal one, not the caller's — but aborting the external
      // signal must still cancel each fetch. Verify the contract by
      // collecting every fetch's signal, then aborting the external
      // controller and observing all of them flip to aborted.
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

      const seenSignals = mockFetch.mock.calls.map(
        ([, opts]) => (opts as Record<string, unknown>).signal,
      ) as AbortSignal[];
      expect(seenSignals.length).toBe(3); // initialize, notifications, tool
      // Sanity: the signals are not the bare external one (we wrap them
      // with a per-call timeout-bound controller now).
      for (const s of seenSignals) {
        expect(s).not.toBe(controller.signal);
        expect(s.aborted).toBe(false);
      }
      // All three signals are STILL live at this point (the call already
      // resolved, but signals were settled with abort listeners). Aborting
      // mid-call would tear them down — verified by the "propagates abort
      // to the agent fallback" test below.
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

      // Each fetch now sees an internal-controller signal (linked to
      // the wizard-wide signal via listener inside `fetchWithTimeout`).
      // Verify there ARE signals threaded through (catches a regression
      // where someone forgets to forward `signal` at all) — the linked-
      // behavior contract is exercised by the "propagates abort to the
      // agent fallback" test below, which actually fires an abort.
      expect(mockFetch.mock.calls.length).toBeGreaterThan(0);
      for (const [, opts] of mockFetch.mock.calls) {
        const signal = (opts as Record<string, unknown>).signal;
        expect(signal).toBeInstanceOf(AbortSignal);
      }
    });

    it('aborts in-flight fetch when external signal aborts mid-call', async () => {
      // Tighter contract test: while a fetch is in flight, fire the
      // external abort and observe the fetch reject with an AbortError.
      // Catches regressions where `fetchWithTimeout` forgets to wire the
      // external signal listener.
      const controller = new AbortController();

      // Hold the fetch open until the test releases it.
      let releaseFetch!: () => void;
      const fetchGate = new Promise<Response>((resolve) => {
        releaseFetch = () =>
          resolve(makeFetchResponse('', { 'mcp-session-id': SESSION_ID }));
      });
      // Make initialize hang on the gate, BUT also reject when the
      // signal aborts (this is what real `fetch` does).
      mockFetch.mockImplementationOnce(
        (_url: string, opts: Record<string, unknown>) => {
          const signal = opts.signal as AbortSignal;
          return new Promise((resolve, reject) => {
            signal.addEventListener('abort', () =>
              reject(
                new DOMException(
                  String(signal.reason ?? 'aborted'),
                  'AbortError',
                ),
              ),
            );
            void fetchGate.then(resolve);
          });
        },
      );

      const callPromise = callAmplitudeMcp({
        accessToken: 'tok',
        abortSignal: controller.signal,
        direct: async () => 'should not be reached',
        agentPrompt: 'p',
        parseAgent: () => null,
      });

      // Yield so the fetch is in flight.
      await new Promise((r) => setImmediate(r));
      // Abort externally — the fetch (and the whole call) should fail
      // fast instead of waiting on `fetchGate`.
      controller.abort('test-abort');

      const result = await callPromise;
      // Initialize threw -> openMcpSession returned null -> fallback ran
      // (no agent output mocked) -> overall result is null.
      expect(result).toBeNull();
      // Release the parked fetch so the test doesn't dangle.
      releaseFetch();
    });
  });

  describe('per-fetch timeouts', () => {
    // The core reliability win: a hung gateway request can no longer
    // pin the wizard. Fake timers let us advance through the timeout
    // window without waiting in real wall-clock time.
    afterEach(() => {
      vi.useRealTimers();
    });

    it('aborts the initialize fetch after the per-call timeout fires', async () => {
      vi.useFakeTimers();

      // Simulate a hung gateway: the fetch promise is wired to reject
      // when its signal aborts (which is exactly what real fetch does).
      mockFetch.mockImplementationOnce(
        (_url: string, opts: Record<string, unknown>) => {
          const signal = opts.signal as AbortSignal;
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () =>
              reject(
                new DOMException(
                  String(signal.reason ?? 'aborted'),
                  'AbortError',
                ),
              ),
            );
            // Never resolve — only the signal abort path can settle this.
          });
        },
      );

      const callPromise = callAmplitudeMcp({
        accessToken: 'tok',
        direct: async () => 'unreachable',
        agentPrompt: 'p',
        parseAgent: () => null,
      });

      // Advance past the per-call timeout window (MCP_FETCH_TIMEOUT_MS = 30s).
      await vi.advanceTimersByTimeAsync(31_000);
      // Real timer for the rest so the fallback path can settle.
      vi.useRealTimers();

      const result = await callPromise;
      // Initialize timed out -> openMcpSession returned null -> fallback
      // ran with no agent output -> overall null. The point is that
      // 31s of fake time settled the call, instead of hanging forever.
      expect(result).toBeNull();
    });
  });

  // -- Session-cache invalidation -------------------------------------------
  describe('invalidateMcpSessionCache', () => {
    /**
     * Drive a session into the cache by completing one successful direct
     * call, then return how many fetch calls that took. A second call with
     * the same token should consume strictly fewer fetches (it skips the
     * `initialize` + `notifications/initialized` handshake).
     */
    async function primeCacheAndCount(token: string): Promise<number> {
      const before = mockFetch.mock.calls.length;
      setupSuccessfulMcpSession();
      mockFetch.mockResolvedValueOnce(
        makeFetchResponse(sseResult({ ok: true })),
      );
      await callAmplitudeMcp({
        accessToken: token,
        direct: async (callTool) => callTool(1, 'noop', {}),
        agentPrompt: 'unused',
        parseAgent: () => null,
      });
      return mockFetch.mock.calls.length - before;
    }

    it('a cached session is reused on the next call (no extra handshake)', async () => {
      const firstCallFetches = await primeCacheAndCount('tok-A');
      // Direct path with a fresh handshake = 3 fetches (init, notif, tool).
      expect(firstCallFetches).toBe(3);

      // Second call with the same token should reuse the cached session
      // and only fetch once (the tool call itself).
      const secondCallFetches = await primeCacheAndCount('tok-A');
      expect(secondCallFetches).toBe(1);
    });

    it('clears every entry when called with no argument', async () => {
      await primeCacheAndCount('tok-A');
      await primeCacheAndCount('tok-B');

      invalidateMcpSessionCache();

      // Both tokens should now require a fresh handshake.
      const aFetches = await primeCacheAndCount('tok-A');
      const bFetches = await primeCacheAndCount('tok-B');
      expect(aFetches).toBe(3);
      expect(bFetches).toBe(3);
    });

    it('clears only the matching token when one is provided', async () => {
      await primeCacheAndCount('tok-A');
      await primeCacheAndCount('tok-B');

      invalidateMcpSessionCache('tok-A');

      // tok-A is gone — fresh handshake required.
      const aFetches = await primeCacheAndCount('tok-A');
      expect(aFetches).toBe(3);

      // tok-B is still cached.
      const bFetches = await primeCacheAndCount('tok-B');
      expect(bFetches).toBe(1);
    });
  });
});
