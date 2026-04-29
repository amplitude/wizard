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

/** Five minutes in milliseconds — refresh proactively before actual expiry. */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

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
  /**
   * Amplitude rotates the idToken on every refresh, but its lifetime is
   * tied to the access token — once the access token expires, the
   * accompanying idToken stops working too. Callers that subsequently
   * use `idToken` to call Data API endpoints (`fetchAmplitudeUser`)
   * MUST swap in this rotated value, otherwise the next API call fails
   * with "Authentication failed" and credential resolution falls
   * through to `auth_required: no_stored_credentials` even though the
   * silent refresh just succeeded. May be `undefined` for unusual
   * server responses (no `id_token` in payload) — in that case the
   * caller keeps the existing idToken; downstream API calls will fail
   * as before, but no worse than today.
   */
  idToken?: string;
  expiresAt: number;
  refreshToken?: string;
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
  idToken?: string;
  expiresAt: number;
  refreshToken?: string;
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

    const expiresAt = now + expiresIn * 1000;

    // Persist rotated refresh token if the server issued a new one
    const newRefreshToken =
      typeof data.refresh_token === 'string' ? data.refresh_token : undefined;

    // Persist rotated idToken too. Amplitude's OIDC refresh response
    // includes a fresh `id_token` whose lifetime is bound to the new
    // access token; without rotating it, downstream `fetchAmplitudeUser`
    // calls reuse the expired idToken from before the refresh and fail
    // with "Authentication failed", which the agent path then surfaces
    // as `auth_required: no_stored_credentials` — an outright lie when
    // we've literally just refreshed.
    const newIdToken =
      typeof data.id_token === 'string' ? data.id_token : undefined;

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
      idToken: newIdToken,
      expiresAt,
      refreshToken: newRefreshToken,
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
