/**
 * Mid-run LLM gateway bearer refresh.
 *
 * The wizard already proactively refreshes the user's Amplitude OAuth
 * access token before the agent starts (`refreshTokenIfStale('pre-run')`
 * in `agent-runner.ts`) and between agent attempts (`agent-interface.ts`
 * inside the retry loop). Neither of those covers the case where a
 * single agent attempt outlives the bearer's lifetime — a 35+ minute
 * Opus run on a token whose id_token TTL is ~1 hour ends with a
 * `400 authentication_error: Token revoked or expired` from
 * `https://core.amplitude.com/wizard/v1/messages` and the wizard
 * discards the entire run.
 *
 * This module provides:
 *
 *   1. {@link refreshGatewayBearer} — extract-and-refresh the OAuth
 *      bearer (via the existing `refreshTokenIfStale` path), mutate the
 *      parent process's `ANTHROPIC_AUTH_TOKEN` /
 *      `CLAUDE_CODE_OAUTH_TOKEN` env vars, and re-stamp the
 *      `Authorization: Bearer …` header on the Amplitude MCP server
 *      config so the SDK subprocess reads the fresh value the next time
 *      it spawns (between attempts) or rotates an MCP session.
 *
 *   2. {@link startGatewayBearerRefreshTimer} — schedule a 5-minute
 *      interval that calls `refreshGatewayBearer` while the agent run
 *      is in flight. When the next `query()` invocation re-reads
 *      `process.env`, it picks up the freshly-rotated token instead of
 *      shipping a stale bearer to the gateway.
 *
 * Pure-ish — the helper takes its dependencies via injection so the
 * unit test can simulate a near-expiry bearer without a real OAuth
 * server or filesystem.
 */

import { logToFile } from '../utils/debug.js';

/** How often the periodic refresh timer fires while the agent is running. */
export const GATEWAY_BEARER_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

type McpServersConfig = Record<string, unknown>;

/**
 * Single side-effect surface for the bearer refresh: rotates env vars +
 * MCP headers atomically when a fresh token comes back. Pulled out so
 * the periodic timer and the per-attempt path share one implementation
 * instead of two near-duplicates that could drift.
 */
export function applyRotatedBearer(args: {
  fresh: string;
  mcpServers: McpServersConfig | undefined;
  updateAmplitudeMcpBearer: (
    servers: McpServersConfig,
    next: string,
  ) => boolean;
}): void {
  const { fresh, mcpServers, updateAmplitudeMcpBearer } = args;
  process.env.ANTHROPIC_AUTH_TOKEN = fresh;
  process.env.CLAUDE_CODE_OAUTH_TOKEN = fresh;
  if (mcpServers) {
    updateAmplitudeMcpBearer(mcpServers, fresh);
  }
}

/**
 * Trigger a silent OAuth refresh if the current bearer is within
 * the staleness window owned by `refreshTokenIfStale`
 * (`EXPIRY_BUFFER_MS` in `utils/token-refresh.ts`), then mirror the
 * result onto `process.env` and the Amplitude MCP server headers.
 *
 * Returns `true` when a rotation actually occurred. The boolean is
 * primarily for tests + telemetry — the side effects are what matter
 * to the runtime.
 */
export async function refreshGatewayBearer(args: {
  /** Label threaded into analytics so we can tell timer vs. attempt. */
  label: string;
  /** MCP server config to re-stamp on success (may be `undefined`). */
  mcpServers?: McpServersConfig;
  /** Injected so unit tests can stub the OAuth path. */
  refreshTokenIfStale: (current: string, label: string) => Promise<string>;
  /** Injected so unit tests don't depend on the real MCP shape. */
  updateAmplitudeMcpBearer: (
    servers: McpServersConfig,
    next: string,
  ) => boolean;
  /** Optional sink for telemetry — keep the helper test-friendly. */
  onRotated?: () => void;
}): Promise<boolean> {
  const current = process.env.ANTHROPIC_AUTH_TOKEN ?? '';
  if (!current) return false;
  let fresh: string;
  try {
    fresh = await args.refreshTokenIfStale(current, args.label);
  } catch (err) {
    // Non-fatal — see callers. The next `/v1/messages` may still 401,
    // but logging a noisy warning is better than crashing the run.
    logToFile(
      `[gateway-bearer-refresh] refreshTokenIfStale threw (${args.label}); continuing with existing bearer:`,
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
  if (!fresh || fresh === current) return false;

  applyRotatedBearer({
    fresh,
    mcpServers: args.mcpServers,
    updateAmplitudeMcpBearer: args.updateAmplitudeMcpBearer,
  });
  args.onRotated?.();
  return true;
}

/**
 * Schedule a 5-minute interval that proactively rotates the bearer
 * during a long agent run. Returns a stop function the caller invokes
 * from its `finally` block so the timer doesn't outlive the run.
 *
 * The timer uses {@link refreshGatewayBearer} under the hood, so it
 * inherits the same staleness skew as the existing pre-run / inter-
 * attempt paths (`EXPIRY_BUFFER_MS` in `utils/token-refresh.ts`) —
 * i.e. it is a true no-op when the stored bearer is still well
 * outside the refresh window.
 */
export function startGatewayBearerRefreshTimer(args: {
  mcpServers?: McpServersConfig;
  refreshTokenIfStale: (current: string, label: string) => Promise<string>;
  updateAmplitudeMcpBearer: (
    servers: McpServersConfig,
    next: string,
  ) => boolean;
  intervalMs?: number;
  onRotated?: () => void;
}): () => void {
  const intervalMs = args.intervalMs ?? GATEWAY_BEARER_REFRESH_INTERVAL_MS;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  // Self-rescheduling `setTimeout` rather than `setInterval`. Two
  // benefits over `setInterval`: (1) we naturally back-pressure if the
  // refresh path itself takes a moment (the next tick only schedules
  // after the prior await resolves), and (2) under fake timers in
  // tests, a long interval that never advances can keep the harness
  // waiting; a setTimeout we explicitly clear on stop is cleaner.
  const schedule = (): void => {
    if (stopped) return;
    timeout = setTimeout(() => {
      // `refreshGatewayBearer` is itself an async no-op when the stored
      // bearer is still outside `EXPIRY_BUFFER_MS` of expiry — the
      // injected `refreshTokenIfStale` short-circuits and returns the
      // same token, so we don't need a separate pre-flight check here.
      void refreshGatewayBearer({
        label: 'mid-run-timer',
        mcpServers: args.mcpServers,
        refreshTokenIfStale: args.refreshTokenIfStale,
        updateAmplitudeMcpBearer: args.updateAmplitudeMcpBearer,
        onRotated: args.onRotated,
      })
        .catch((err: unknown) => {
          logToFile(
            '[gateway-bearer-refresh] periodic refresh tick failed:',
            err instanceof Error ? err.message : String(err),
          );
        })
        .finally(() => {
          schedule();
        });
    }, intervalMs);
    // Don't keep the event loop alive just for the refresh timer —
    // when the agent run finishes, Node should be free to exit even
    // if the caller's `finally` hasn't run yet.
    if (timeout && typeof timeout.unref === 'function') timeout.unref();
  };

  schedule();

  return () => {
    stopped = true;
    if (timeout) clearTimeout(timeout);
  };
}
