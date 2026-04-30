/**
 * Utility for making authenticated calls to the Amplitude MCP server with
 * automatic Claude agent fallback.
 *
 * When the direct HTTP call fails (tool removed, auth error, parse failure,
 * etc.) the function re-runs the same query via a minimal Claude agent that
 * has only the Amplitude MCP server configured. This insulates callers from
 * MCP API drift without requiring them to write two code paths.
 */

import path from 'path';
import { logToFile } from '../utils/debug.js';
import { getWizardAbortSignal } from '../utils/wizard-abort.js';
import { getMcpUrlFromZone } from '../utils/urls.js';
import { WIZARD_USER_AGENT } from './constants.js';
import { safeParseSDKMessage } from './middleware/schemas.js';
import { withWizardSpan, addBreadcrumb } from './observability/index.js';

/**
 * Default MCP URL when no zone is known to the caller.
 *
 * Most consumers (`agent-runner`, `agent-interface.buildDefaultAgentConfig`,
 * `addMCPServerToClientsStep`) DO know the zone and should pass `mcpUrl`
 * explicitly via `getMcpUrlFromZone(zone)`. This constant exists for the
 * narrow set of callers that genuinely have no zone context (bootstrap
 * paths, test mocks); falling back to US matches the historical behaviour.
 *
 * Honors the `MCP_URL` env override for tests / dev.
 */
export const AMPLITUDE_MCP_URL = getMcpUrlFromZone('us');

// ── SDK dynamic import ────────────────────────────────────────────────────────

type SDKQueryFn = (params: {
  prompt: string | AsyncIterable<unknown>;
  options?: Record<string, unknown>;
}) => AsyncIterable<unknown>;

let _sdkModule: { query: SDKQueryFn } | null = null;
async function getSDKModule(): Promise<{ query: SDKQueryFn }> {
  if (!_sdkModule) {
    const mod = await import('@anthropic-ai/claude-agent-sdk');
    _sdkModule = { query: mod.query as SDKQueryFn };
  }
  return _sdkModule;
}

function getClaudeCodeExecutablePath(): string {
  const sdkPackagePath = require.resolve('@anthropic-ai/claude-agent-sdk');
  return path.join(path.dirname(sdkPackagePath), 'cli.js');
}

// ── MCP session helpers ───────────────────────────────────────────────────────

/**
 * Process-scoped MCP session cache. Without this, every `callAmplitudeMcp`
 * call paid one full `initialize` + `notifications/initialized` HTTP
 * round-trip (~50–200 ms each) — one per call, even when consecutive
 * calls hit the same server with the same token.
 *
 * Keyed on `accessToken|mcpUrl` so a token rotation or zone switch
 * forces a fresh handshake, but otherwise we reuse the cached session
 * for a soft TTL window. Failures fall through to the agent fallback
 * exactly like before — caching only short-circuits the happy path.
 */
type CallToolFnInternal = (
  id: number,
  name: string,
  args: unknown,
) => Promise<string | null>;

/**
 * Outcome of an MCP session open attempt.
 *
 * `deterministic: true` signals that retrying via the agent fallback would
 * hit the same wall (e.g. HTTP 401/403 with the same access token), so the
 * caller should fail fast instead of paying the multi-second agent
 * subprocess cost. `deterministic: false` is the historical "transient
 * failure" path — fallback may help.
 */
type SessionOpenResult =
  | { ok: true; callTool: CallToolFnInternal }
  | { ok: false; deterministic: boolean; reason: string };
const MCP_SESSION_TTL_MS = 60_000;

// ── Per-fetch timeouts ────────────────────────────────────────────────────────
//
// Without these caps, a hung MCP gateway pinned the wizard with no upper
// bound: `openMcpSessionInner` and the bound `callTool` closure both
// awaited bare `fetch(...)` calls relying solely on the caller's external
// abort signal. In practice that meant a hang propagated all the way up
// to the outer agent's stall timer (60s) before anything reacted,
// burning the entire SDK turn for what was usually a single hung request.
//
// Matched against the rest of the wizard's network budget:
//   - Token-refresh: 10s
//   - Gateway-liveness probe: 8s
//   - Agent fallback: 12s
//   - SSE stream stall: 60s (active phase)
// 30s for tool calls is generous (the Amplitude MCP server typically
// responds in <2s; 30s suggests something is wrong) and 5s for the
// fire-and-forget `notifications/initialized` is generous (we don't
// even use the response). The fetch is still race-cancelled by the
// caller's external signal — these caps are the upper bound, not a
// floor.

/** Tool-call + initialize round-trip cap. */
const MCP_FETCH_TIMEOUT_MS = 30_000;
/** Fire-and-forget `notifications/initialized` cap. */
const MCP_NOTIFY_TIMEOUT_MS = 5_000;

/**
 * `fetch` wrapped with a per-call timeout, covering both the request
 * round-trip AND body consumption. Combines the caller's external
 * `AbortSignal` (if any) with an internal `AbortController` so either
 * source — caller cancellation OR timeout — tears the request down
 * immediately.
 *
 * Body consumption (`res.text()`, `res.json()`, `res.body.cancel()`)
 * MUST happen inside the `consume` callback. The timer and abort
 * listener stay armed for the entire callback so a slow body read can
 * still be cancelled. Cleanup runs unconditionally in `finally` — no
 * leaked timers or listeners on the success path.
 *
 * Throws on timeout exactly the way `fetch` throws on caller-side
 * abort: an `AbortError` from the underlying controller. Callers that
 * already have `try/catch` on `fetch` need no changes; the existing
 * `[MCP] X failed: ...` log lines absorb the new error class.
 *
 * Why caller-supplied consume:
 *   Returning a bare `Response` made it ambiguous whether the timer
 *   covered the body read. Two prior implementations bounced between
 *   "cleanup in finally before body read" (body unbounded) and
 *   "cleanup only on error" (success-path leak). The callback shape
 *   resolves both — the timer is alive exactly as long as the caller
 *   is consuming the response, and dies the moment the consumer
 *   returns or throws.
 */
async function fetchWithTimeout<T>(
  url: string,
  init: Parameters<typeof fetch>[1],
  timeoutMs: number,
  externalSignal: AbortSignal | undefined,
  consume: (res: Response) => Promise<T>,
): Promise<T> {
  // Bail immediately if the external signal is already aborted —
  // matches the standard `fetch` contract for already-aborted signals.
  if (externalSignal?.aborted) {
    throw new DOMException(
      String(externalSignal.reason ?? 'aborted'),
      'AbortError',
    );
  }
  const controller = new AbortController();
  const onExternalAbort = (): void => controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return await consume(res);
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}
const mcpSessionCache = new Map<
  string,
  { callTool: CallToolFnInternal; expiresAt: number }
>();
function getCachedMcpSession(
  accessToken: string,
  mcpUrl: string,
): CallToolFnInternal | null {
  const key = `${accessToken}|${mcpUrl}`;
  const entry = mcpSessionCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    mcpSessionCache.delete(key);
    return null;
  }
  return entry.callTool;
}
function cacheMcpSession(
  accessToken: string,
  mcpUrl: string,
  callTool: CallToolFnInternal,
): void {
  const key = `${accessToken}|${mcpUrl}`;
  mcpSessionCache.set(key, {
    callTool,
    expiresAt: Date.now() + MCP_SESSION_TTL_MS,
  });
}
/** Test-only: clear the cache between unit-test cases. */
export function _clearMcpSessionCacheForTesting(): void {
  mcpSessionCache.clear();
}

/**
 * Drop every cached MCP session bound to `accessToken`. Call after
 * silently refreshing the OAuth token so the next `callAmplitudeMcp`
 * doesn't reuse a `callTool` closure carrying the now-expired bearer
 * (which would 401 on the upstream and force the slower agent fallback
 * for ~12s, even though we already have a fresh token in hand).
 *
 * Idempotent — no-op when no entries match.
 */
export function invalidateMcpSessionsForToken(accessToken: string): void {
  if (!accessToken) return;
  const prefix = `${accessToken}|`;
  for (const key of mcpSessionCache.keys()) {
    if (key.startsWith(prefix)) mcpSessionCache.delete(key);
  }
}

/**
 * Open an MCP session and return a `callTool` helper bound to that session.
 * Returns a tagged result so callers can distinguish transient failures
 * (worth falling back to the agent path) from deterministic ones (auth
 * errors — agent fallback uses the same token and would just hit the
 * same wall). Reuses a cached session for the same `accessToken|mcpUrl`
 * pair when it's still fresh.
 */
async function openMcpSession(
  accessToken: string,
  mcpUrl: string,
  signal?: AbortSignal,
): Promise<SessionOpenResult> {
  const cached = getCachedMcpSession(accessToken, mcpUrl);
  if (cached) {
    logToFile('[MCP] reusing cached session');
    return { ok: true, callTool: cached };
  }
  return withWizardSpan(
    'mcp.session.init',
    'mcp.session',
    { 'mcp.url': mcpUrl },
    async () => {
      const fresh = await openMcpSessionInner(accessToken, mcpUrl, signal);
      if (fresh.ok) cacheMcpSession(accessToken, mcpUrl, fresh.callTool);
      return fresh;
    },
  );
}

async function openMcpSessionInner(
  accessToken: string,
  mcpUrl: string,
  signal?: AbortSignal,
): Promise<SessionOpenResult> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': WIZARD_USER_AGENT,
  };

  let sessionId: string | undefined;
  try {
    // Pull status + session id inside the consume callback so the body
    // cancel happens while the timer + external abort are still armed.
    const initOutcome = await fetchWithTimeout(
      mcpUrl,
      {
        method: 'POST',
        headers: { ...headers, Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 0,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'amplitude-wizard', version: '1.0.0' },
          },
        }),
      },
      MCP_FETCH_TIMEOUT_MS,
      signal,
      async (res) => {
        const status = res.status;
        const extractedSessionId =
          res.headers.get('mcp-session-id') ?? undefined;
        await res.body?.cancel().catch(() => undefined);
        return { status, sessionId: extractedSessionId };
      },
    );
    // 401/403 mean the access token is bad. The agent fallback uses the
    // same token, so it would just hit the same wall after a 12s setup —
    // fail fast instead. 5xx is transient (gateway hiccup); fall through.
    if (initOutcome.status === 401 || initOutcome.status === 403) {
      logToFile(
        `[MCP] initialize rejected by gateway (HTTP ${initOutcome.status}) — skipping agent fallback`,
      );
      addBreadcrumb('mcp', `Initialize rejected (HTTP ${initOutcome.status})`, {
        status: initOutcome.status,
      });
      return {
        ok: false,
        deterministic: true,
        reason: `http-${initOutcome.status}`,
      };
    }
    sessionId = initOutcome.sessionId;
  } catch (err) {
    logToFile(
      `[MCP] initialize failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { ok: false, deterministic: false, reason: 'init-error' };
  }

  if (!sessionId) {
    return { ok: false, deterministic: false, reason: 'no-session-id' };
  }

  try {
    // Fire-and-forget — body is cancelled inside the timeout window.
    await fetchWithTimeout(
      mcpUrl,
      {
        method: 'POST',
        headers: { ...headers, 'Mcp-Session-Id': sessionId },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      },
      MCP_NOTIFY_TIMEOUT_MS,
      signal,
      async (res) => {
        await res.body?.cancel().catch(() => undefined);
      },
    );
  } catch {
    logToFile('[MCP] notifications/initialized failed (continuing)');
  }

  const callTool: CallToolFnInternal = async (
    id: number,
    name: string,
    args: unknown,
  ): Promise<string | null> =>
    withWizardSpan(
      `mcp.tool.${name}`,
      'mcp.tool_call',
      { 'mcp.tool': name, 'mcp.session_id': sessionId },
      async () => {
        try {
          // Read the body inside the timeout window — a hung body read
          // (gateway buffers the headers but stalls on data) would
          // otherwise pin the call past `MCP_FETCH_TIMEOUT_MS`.
          const body = await fetchWithTimeout(
            mcpUrl,
            {
              method: 'POST',
              headers: {
                ...headers,
                'Mcp-Session-Id': sessionId,
                Accept: 'application/json, text/event-stream',
              },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id,
                method: 'tools/call',
                params: { name, arguments: args },
              }),
            },
            MCP_FETCH_TIMEOUT_MS,
            signal,
            async (res) => res.text(),
          );
          const sseData = body.match(/^data: (.+)$/m)?.[1] ?? '';
          const rpc = JSON.parse(sseData) as {
            result?: { content?: Array<{ text?: string }> };
            error?: { code?: number; message?: string };
          };
          if (rpc.error) {
            logToFile(`[MCP] ${name} rpc error: ${JSON.stringify(rpc.error)}`);
            addBreadcrumb('mcp', `Tool ${name} returned RPC error`, {
              code: rpc.error.code,
              message: rpc.error.message,
            });
            return null;
          }
          return rpc.result?.content?.[0]?.text ?? null;
        } catch (err) {
          logToFile(
            `[MCP] ${name} error: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          addBreadcrumb('mcp', `Tool ${name} threw`, {
            error: err instanceof Error ? err.message : String(err),
          });
          return null;
        }
      },
    );

  return { ok: true, callTool };
}

// ── Agent fallback ────────────────────────────────────────────────────────────

// Cap how long we'll burn before giving up on the agent fallback. Was
// 30s historically — that's long enough to make a stuck Amplitude MCP
// look like the wizard is hung. 12s still covers a slow-but-recovering
// upstream (typical recovery is under 5s) while bounding the worst case
// to a fraction of the original.
const AGENT_FALLBACK_TIMEOUT_MS = 12_000;

async function runAgentFallback(
  accessToken: string,
  mcpUrl: string,
  agentPrompt: string,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<string> {
  return withWizardSpan(
    'mcp.fallback.agent',
    'mcp.fallback',
    { 'mcp.url': mcpUrl, timeout_ms: timeoutMs },
    async () =>
      runAgentFallbackInner(
        accessToken,
        mcpUrl,
        agentPrompt,
        timeoutMs,
        externalSignal,
      ),
  );
}

async function runAgentFallbackInner(
  accessToken: string,
  mcpUrl: string,
  agentPrompt: string,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<string> {
  const { query } = await getSDKModule();
  const cliPath = getClaudeCodeExecutablePath();

  // Combine the timeout with any external abort signal.
  // AbortSignal.any() requires Node 20.3+; we support 18.17+, so we wire it manually.
  const controller = new AbortController();
  if (externalSignal?.aborted) {
    controller.abort();
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = (): void => controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

  const collectedText: string[] = [];
  try {
    const response = query({
      prompt: agentPrompt,
      options: {
        claudeCodePath: cliPath,
        permissionMode: 'bypassPermissions',
        allowedTools: [],
        mcpServers: {
          amplitude: {
            type: 'http',
            url: mcpUrl,
            headers: { Authorization: `Bearer ${accessToken}` },
          },
        },
        abortSignal: controller.signal,
      },
    });

    for await (const rawMessage of response) {
      const parsed = safeParseSDKMessage(rawMessage);
      if (!parsed.ok) continue;
      const message = parsed.message;
      if (message.type === 'assistant') {
        const content = message.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && typeof block.text === 'string') {
              collectedText.push(block.text);
            }
          }
        }
      }
    }
  } catch (err) {
    logToFile(
      `[MCP-fallback] agent error: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }

  return collectedText.join('');
}

// ── Public API ────────────────────────────────────────────────────────────────

export type CallToolFn = (
  id: number,
  name: string,
  args: unknown,
) => Promise<string | null>;

export interface CallAmplitudeMcpOptions<T> {
  accessToken: string;
  mcpUrl?: string;
  /**
   * The direct MCP call path. Receives a `callTool` helper bound to an open
   * session. Return `null` to trigger the agent fallback.
   *
   * When omitted, the MCP session handshake is skipped entirely and the agent
   * fallback runs immediately. Use this when there is no single MCP tool that
   * can satisfy the request and orchestration must be done by the agent.
   */
  direct?: (callTool: CallToolFn) => Promise<T | null>;
  /** Prompt sent to the Claude agent when the direct path returns null or throws. */
  agentPrompt: string;
  /** Extract the result from the agent's collected text output. Return null if unparseable. */
  parseAgent: (text: string) => T | null;
  label?: string;
  agentTimeoutMs?: number;
  /**
   * Optional signal from the caller's AbortController. When aborted, in-flight
   * fetch requests and the agent fallback subprocess are cancelled immediately.
   * The top-level application should wire this to its exit / cleanup handler.
   */
  abortSignal?: AbortSignal;
}

/**
 * Make an authenticated call to the Amplitude MCP server.
 *
 * 1. Opens an MCP session and calls `opts.direct(callTool)`.
 * 2. If the direct call returns `null` or throws, falls back to a minimal
 *    Claude agent with only the Amplitude MCP configured.
 * 3. Passes the agent's text output to `opts.parseAgent` and returns the result.
 *
 * Returns `null` if both paths fail.
 */
export async function callAmplitudeMcp<T>(
  opts: CallAmplitudeMcpOptions<T>,
): Promise<T | null> {
  const {
    accessToken,
    mcpUrl = AMPLITUDE_MCP_URL,
    direct,
    agentPrompt,
    parseAgent,
    label = 'callAmplitudeMcp',
    agentTimeoutMs = AGENT_FALLBACK_TIMEOUT_MS,
    // Default to the wizard-wide abort signal so callers automatically
    // pick up Ctrl+C / SIGINT cancellation. Pass `abortSignal: undefined`
    // explicitly only in tests that need un-aborted isolation.
    abortSignal = getWizardAbortSignal(),
  } = opts;

  return withWizardSpan(
    `mcp.call.${label}`,
    'mcp.call',
    { 'mcp.label': label, 'mcp.url': mcpUrl },
    async () => {
      addBreadcrumb('mcp', `callAmplitudeMcp:${label} starting`);
      const result = await callAmplitudeMcpInner(
        accessToken,
        mcpUrl,
        direct,
        agentPrompt,
        parseAgent,
        label,
        agentTimeoutMs,
        abortSignal,
      );
      addBreadcrumb('mcp', `callAmplitudeMcp:${label} done`, {
        ok: result !== null,
      });
      return result;
    },
  );
}

async function callAmplitudeMcpInner<T>(
  accessToken: string,
  mcpUrl: string,
  direct: ((callTool: CallToolFn) => Promise<T | null>) | undefined,
  agentPrompt: string,
  parseAgent: (text: string) => T | null,
  label: string,
  agentTimeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<T | null> {
  // ── Direct path ────────────────────────────────────────────────────────────
  let directResult: T | null = null;
  let useFallback = false;

  if (direct) {
    const session = await openMcpSession(accessToken, mcpUrl, abortSignal);
    if (session.ok) {
      try {
        directResult = await direct(session.callTool);
        if (directResult === null) {
          logToFile(`[${label}] direct returned null — trying agent fallback`);
          useFallback = true;
        }
      } catch (err) {
        logToFile(
          `[${label}] direct threw — trying agent fallback: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        useFallback = true;
      }
    } else if (session.deterministic) {
      // Agent fallback uses the same access token, so the same auth
      // failure would just repeat after a 12s subprocess spin-up.
      // Surface the failure now and let the caller decide.
      logToFile(
        `[${label}] MCP session failed deterministically (${session.reason}) — skipping agent fallback`,
      );
      addBreadcrumb('mcp', `${label}: skipping fallback (deterministic)`, {
        reason: session.reason,
      });
      return null;
    } else {
      logToFile(
        `[${label}] MCP session failed (${session.reason}) — trying agent fallback`,
      );
      useFallback = true;
    }
  } else {
    logToFile(`[${label}] no direct path — using agent fallback`);
    useFallback = true;
  }

  if (!useFallback) return directResult;

  // ── Agent fallback ────────────────────────────────────────────────────────
  logToFile(`[${label}] running agent fallback`);
  const agentText = await runAgentFallback(
    accessToken,
    mcpUrl,
    agentPrompt,
    agentTimeoutMs,
    abortSignal,
  );

  if (!agentText) {
    logToFile(`[${label}] agent fallback produced no output`);
    return null;
  }

  const parsed = parseAgent(agentText);
  if (parsed === null) {
    logToFile(`[${label}] parseAgent returned null`);
  }
  return parsed;
}
