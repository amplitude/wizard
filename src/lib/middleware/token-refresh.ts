/**
 * Token-refresh middleware — silently rotates the OAuth bearer token
 * before each LLM gateway call when the stored token is within the
 * `EXPIRY_BUFFER_MS` window (5 minutes before expiry).
 *
 * ## Why this exists
 *
 * `agent-runner.ts` calls `refreshTokenIfStale` twice: once at the
 * pre-run boundary and once at the post-run boundary. Long runs
 * (>~55 minutes on a large repo) push past the OAuth token's 1-hour
 * TTL between those two checkpoints, surfacing
 * "WizardError: Authentication failed during agent run" mid-flight
 * (Sentry WIZARD-CLI-F). This middleware closes that gap by checking
 * expiry on every assistant message — the natural heartbeat of an
 * active agent loop — and rotating before the gateway sees a stale
 * bearer.
 *
 * ## Performance
 *
 * The hot path is a single in-memory timestamp comparison:
 *
 *   if (Date.now() < this.nextCheckAt) return;   // O(1), no I/O
 *
 * `nextCheckAt` is updated to `Date.now() + CHECK_INTERVAL_MS` after
 * each check so disk reads (getStoredToken) happen at most once per
 * CHECK_INTERVAL_MS regardless of how many messages arrive. A 30-second
 * interval means at most 2 disk reads per minute — negligible against
 * LLM round-trip latencies measured in seconds.
 *
 * The actual HTTP refresh exchange (a POST to the OAuth token endpoint)
 * only fires when `expiresAt - now <= EXPIRY_BUFFER_MS` — i.e. within
 * the 5-minute pre-expiry window. Typical runs never hit this branch.
 *
 * ## Wiring
 *
 * Add to the middleware pipeline in `agent-runner.ts` alongside
 * `createRetryMiddleware`. Pass `onTokenRefreshed` so the runner can
 * mirror the new token back onto `session.credentials.accessToken` and
 * onto the agent's HTTP client before the next gateway request fires.
 *
 * ```ts
 * const tokenRefreshMiddleware = createTokenRefreshMiddleware({
 *   getToken: () => accessToken,
 *   onTokenRefreshed: (fresh) => {
 *     accessToken = fresh;
 *     if (session.credentials) session.credentials.accessToken = fresh;
 *   },
 * });
 * ```
 */

import type {
  Middleware,
  SDKMessage,
  MiddlewareContext,
  MiddlewareStore,
} from './types.js';
import { logToFile } from '../../utils/debug.js';
import { analytics } from '../../utils/analytics.js';
import { refreshTokenIfStale } from '../../utils/token-refresh.js';

/**
 * How often to re-read the stored token from disk and compare its
 * expiry. Capped at once per interval to keep disk I/O negligible.
 * 30 seconds is well below the 5-minute EXPIRY_BUFFER_MS window, so
 * we never miss a rotation that's due.
 */
export const CHECK_INTERVAL_MS = 30_000;

export interface TokenRefreshMiddlewareOptions {
  /**
   * Returns the current in-memory access token. Called on each
   * check so the middleware always sees the latest value (e.g. after
   * a concurrent refresh triggered by another path).
   */
  getToken: () => string;

  /**
   * Called with the freshly-rotated token immediately after a
   * successful silent refresh. The caller MUST mirror this value back
   * onto `session.credentials.accessToken` and onto any HTTP client
   * headers that carry the bearer — the middleware itself has no
   * reference to those call sites.
   */
  onTokenRefreshed: (newToken: string) => void;
}

/**
 * Build a middleware that proactively refreshes the OAuth bearer token
 * mid-run, before each LLM gateway call, to prevent token expiry on
 * long-running agent sessions.
 */
export function createTokenRefreshMiddleware(
  opts: TokenRefreshMiddlewareOptions,
): Middleware {
  // Wall-clock time after which the next check is permitted.
  // Initialised to 0 so the first assistant message always triggers
  // a check — this catches sessions started with a token already close
  // to expiry that the pre-run refresh didn't rotate (e.g. a resumed
  // session whose on-disk token was refreshed by a concurrent wizard
  // instance between runs).
  let nextCheckAt = 0;

  // Guard against concurrent refresh calls. If `refreshTokenIfStale`
  // is already in flight (slow OAuth server, flaky network) we skip
  // rather than stack a second call on top. The next assistant message
  // will re-check once `inFlight` clears.
  let inFlight = false;

  async function maybeRefresh(): Promise<void> {
    const now = Date.now();
    if (now < nextCheckAt) return;
    if (inFlight) return;

    // Push the next check window forward immediately — before any async
    // work — so concurrent messages arriving while the refresh is in
    // flight don't stack additional calls.
    nextCheckAt = now + CHECK_INTERVAL_MS;
    inFlight = true;

    try {
      const currentToken = opts.getToken();
      const fresh = await refreshTokenIfStale(currentToken, 'mid-run');
      if (fresh !== currentToken) {
        logToFile('[token-refresh-mw] mid-run token rotated');
        analytics.wizardCapture('auth refreshed silently', {
          label: 'mid-run',
        });
        opts.onTokenRefreshed(fresh);
      }
    } catch (err) {
      // Never throw from middleware — a failed refresh attempt is
      // logged and the next check will try again after CHECK_INTERVAL_MS.
      logToFile(
        '[token-refresh-mw] refresh attempt failed',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      inFlight = false;
    }
  }

  return {
    name: 'token-refresh',

    onMessage(
      message: SDKMessage,
      _ctx: MiddlewareContext,
      _store: MiddlewareStore,
    ): void {
      // Only check on assistant messages — these are the natural
      // boundaries between LLM gateway round-trips. System messages
      // (api_retry, phase markers) and tool-result messages don't
      // precede a new gateway call, so checking on them would be
      // redundant noise.
      //
      // `result` messages mark the final SDK envelope and arrive after
      // the last gateway call has already completed — no value in
      // refreshing there.
      if (message.type !== 'assistant') return;

      // Fire-and-forget: the refresh is async but we must not await
      // inside `onMessage` (the pipeline interface is synchronous).
      // The `inFlight` guard ensures at most one refresh runs at a time;
      // the `nextCheckAt` guard throttles disk reads between refreshes.
      void maybeRefresh();
    },
  };
}
