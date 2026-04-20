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
import { WIZARD_USER_AGENT } from './constants.js';
import { safeParseSDKMessage } from './middleware/schemas.js';

export const AMPLITUDE_MCP_URL =
  process.env.MCP_URL ?? 'https://mcp.amplitude.com/mcp';

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
 * Open an MCP session and return a `callTool` helper bound to that session.
 * Returns null if the session cannot be established.
 */
async function openMcpSession(
  accessToken: string,
  mcpUrl: string,
  signal?: AbortSignal,
): Promise<
  ((id: number, name: string, args: unknown) => Promise<string | null>) | null
> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': WIZARD_USER_AGENT,
  };

  let sessionId: string | undefined;
  try {
    const initRes = await fetch(mcpUrl, {
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
      signal,
    });
    sessionId = initRes.headers.get('mcp-session-id') ?? undefined;
    await initRes.body?.cancel().catch(() => undefined);
  } catch (err) {
    logToFile(
      `[MCP] initialize failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }

  if (!sessionId) return null;

  try {
    const notifRes = await fetch(mcpUrl, {
      method: 'POST',
      headers: { ...headers, 'Mcp-Session-Id': sessionId },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
      signal,
    });
    await notifRes.body?.cancel().catch(() => undefined);
  } catch {
    logToFile('[MCP] notifications/initialized failed (continuing)');
  }

  return async (
    id: number,
    name: string,
    args: unknown,
  ): Promise<string | null> => {
    try {
      const res = await fetch(mcpUrl, {
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
        signal,
      });
      const body = await res.text();
      const sseData = body.match(/^data: (.+)$/m)?.[1] ?? '';
      const rpc = JSON.parse(sseData) as {
        result?: { content?: Array<{ text?: string }> };
        error?: { code?: number; message?: string };
      };
      if (rpc.error) {
        logToFile(`[MCP] ${name} rpc error: ${JSON.stringify(rpc.error)}`);
        return null;
      }
      return rpc.result?.content?.[0]?.text ?? null;
    } catch (err) {
      logToFile(
        `[MCP] ${name} error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  };
}

// ── Agent fallback ────────────────────────────────────────────────────────────

const AGENT_FALLBACK_TIMEOUT_MS = 30_000;

async function runAgentFallback(
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
    abortSignal,
  } = opts;

  // ── Direct path ────────────────────────────────────────────────────────────
  let directResult: T | null = null;
  let useFallback = false;

  if (direct) {
    const callTool = await openMcpSession(accessToken, mcpUrl, abortSignal);
    if (callTool) {
      try {
        directResult = await direct(callTool);
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
    } else {
      logToFile(`[${label}] MCP session failed — trying agent fallback`);
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
