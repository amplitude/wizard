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

/** Five minutes in milliseconds — refresh proactively before actual expiry. */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

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
): Promise<{ accessToken: string; expiresAt: number } | null> {
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
    return null;
  }

  logToFile(
    '[token-refresh] access token expired or expiring soon, attempting silent refresh',
    {
      expiresAt: new Date(storedEntry.expiresAt).toISOString(),
      zone,
    },
  );

  // 3. Exchange the refresh token for a new access token
  try {
    const { oAuthHost, oAuthClientId } = AMPLITUDE_ZONE_SETTINGS[zone];
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: storedEntry.refreshToken,
      client_id: oAuthClientId,
    });

    const response = await fetch(`${oAuthHost}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      logToFile('[token-refresh] refresh request failed', {
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

    logToFile('[token-refresh] silent refresh succeeded', {
      expiresAt: new Date(expiresAt).toISOString(),
    });

    return { accessToken, expiresAt };
  } catch (err) {
    logToFile(
      '[token-refresh] refresh failed',
      err instanceof Error ? err.message : 'unknown error',
    );
    return null;
  }
}
