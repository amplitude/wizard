/**
 * Silent OAuth token refresh — lightweight utility that exchanges an expired
 * access token for a new one using a stored refresh token, without opening
 * the browser or importing heavy dependencies.
 *
 * Returns null on any failure so the caller can fall back to full browser auth.
 */

import {
  AMPLITUDE_ZONE_SETTINGS,
  DEFAULT_AMPLITUDE_ZONE,
  type AmplitudeZone,
} from '../lib/constants.js';
import { logToFile } from './debug.js';
import { withWizardSpan, addBreadcrumb } from '../lib/observability/index.js';

/**
 * Five minutes in milliseconds — refresh proactively before actual expiry.
 * Exported so other refresh paths (notably the polling refresh inside
 * `DataIngestionCheckScreen`) apply the same skew tolerance and don't 401
 * on users whose laptop clock drifted by a few seconds.
 */
export const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/**
 * Bound on the OAuth refresh-token HTTP exchange. The wizard blocks on this
 * call before any other auth path runs, so an unbounded fetch on a hung
 * connection would freeze the entire startup. 10s is generous for what is
 * normally a sub-200ms request and matches the gateway-liveness probe.
 */
const REFRESH_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Attempts a silent OAuth token refresh if the access token is expired or
 * expiring within 5 minutes. Returns new token data on success, or null if
 * refresh is not needed, not possible, or fails.
 */
export async function tryRefreshToken(
  storedEntry: {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
  },
  zone: AmplitudeZone = DEFAULT_AMPLITUDE_ZONE,
): Promise<{
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  /**
   * Refreshed OIDC id_token, when the OAuth server returns one.
   * Ory issues a new id_token on every refresh as long as the original
   * authorization included the `openid` scope. The wizard's API client
   * authenticates with the id_token (not the access token) for every
   * `fetchAmplitudeUser` / `getAPIKey` call, so persisting it is what
   * keeps long-lived sessions working — without it the access token
   * gets refreshed but the next `fetchAmplitudeUser` 401s on a stale
   * id_token, the catch block falls through to `apiKeyNotice`, and
   * the run dies as `auth_required: no_stored_credentials` even
   * though the refresh succeeded.
   */
  idToken?: string;
} | null> {
  // 1. Check whether the token actually needs refreshing
  const now = Date.now();
  if (storedEntry.expiresAt - now > EXPIRY_BUFFER_MS) {
    // Token is still valid — no refresh needed
    return null;
  }

  // 2. A refresh token is required
  if (!storedEntry.refreshToken) {
    logToFile(
      '[token-refresh] access token expired but no refresh token stored',
    );
    addBreadcrumb('auth', 'Silent refresh skipped — no refresh token');
    return null;
  }

  logToFile(
    '[token-refresh] access token expired or expiring soon, attempting silent refresh',
    {
      expiresAt: new Date(storedEntry.expiresAt).toISOString(),
      zone,
    },
  );
  addBreadcrumb('auth', 'Silent refresh starting', { zone });

  return withWizardSpan(
    'auth.token_refresh',
    'auth.token_refresh',
    { zone },
    async () => tryRefreshTokenInner(storedEntry.refreshToken!, zone, now),
  );
}

async function tryRefreshTokenInner(
  refreshToken: string,
  zone: AmplitudeZone,
  now: number,
): Promise<{
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  idToken?: string;
} | null> {
  // Exchange the refresh token for a new access token
  try {
    const { oAuthHost, oAuthClientId } = AMPLITUDE_ZONE_SETTINGS[zone];
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: oAuthClientId,
    });

    // Bound the fetch with an AbortController + clearTimeout pair so a
    // network stall doesn't block the wizard's startup path indefinitely.
    // The timer is cleared on the win path inside `finally`.
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      REFRESH_REQUEST_TIMEOUT_MS,
    );
    let response: Response;
    try {
      response = await fetch(`${oAuthHost}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      logToFile('[token-refresh] refresh request failed', {
        status: response.status,
        statusText: response.statusText,
      });
      addBreadcrumb('auth', 'Silent refresh failed (non-2xx)', {
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;

    const accessToken = data.access_token;
    const expiresIn = data.expires_in;

    if (typeof accessToken !== 'string' || typeof expiresIn !== 'number') {
      logToFile('[token-refresh] unexpected response shape', {
        hasAccessToken: typeof accessToken,
        hasExpiresIn: typeof expiresIn,
      });
      return null;
    }

    // Pull the rotated id_token. Ory returns one on every refresh when the
    // original auth included `openid` scope (we always do). The id_token's
    // `exp` is shorter than the access token's, so without persisting it,
    // long-lived sessions break: the refreshed access token would be valid,
    // but the still-stale id_token would 401 every API call that uses it.
    const newIdToken =
      typeof data.id_token === 'string' ? data.id_token : undefined;

    // `expiresAt` controls when `tryRefreshToken` next fires. Source it
    // from the rotated id_token's `exp` claim so the trigger aligns to
    // the binding constraint (id_token TTL), not access_token TTL. Falls
    // back to `expires_in` if the JWT isn't decodable. See
    // `src/utils/jwt-exp.ts`.
    const { resolveStoredExpiryMs } = await import('./jwt-exp.js');
    const expiresAt = resolveStoredExpiryMs({
      idToken: newIdToken,
      expiresInSeconds: expiresIn,
      now,
    });

    // Persist rotated refresh token if the server issued a new one
    const newRefreshToken =
      typeof data.refresh_token === 'string' ? data.refresh_token : undefined;

    logToFile('[token-refresh] silent refresh succeeded', {
      expiresAt: new Date(expiresAt).toISOString(),
      rotatedRefreshToken: !!newRefreshToken,
      rotatedIdToken: !!newIdToken,
    });
    addBreadcrumb('auth', 'Silent refresh succeeded', {
      rotated_refresh_token: !!newRefreshToken,
      rotated_id_token: !!newIdToken,
    });

    return {
      accessToken,
      expiresAt,
      refreshToken: newRefreshToken,
      idToken: newIdToken,
    };
  } catch (err) {
    // Distinguish abort/timeout (controller aborted the fetch) from other
    // failures so it's easy to triage stuck startups in the log file.
    const isAbort =
      err instanceof Error &&
      (err.name === 'AbortError' ||
        (err as Error & { code?: string }).code === 'ABORT_ERR');
    logToFile(
      isAbort
        ? `[token-refresh] refresh timed out after ${REFRESH_REQUEST_TIMEOUT_MS}ms`
        : '[token-refresh] refresh failed',
      err instanceof Error ? err.message : 'unknown error',
    );
    addBreadcrumb(
      'auth',
      isAbort ? 'Silent refresh timed out' : 'Silent refresh threw',
      {
        error: err instanceof Error ? err.message : String(err),
      },
    );
    return null;
  }
}
