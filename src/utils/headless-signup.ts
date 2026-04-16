/**
 * Headless signup — browserless account creation via the App API
 * provisioning endpoint. Gated behind the `wizard-headless-signup` flag.
 *
 * The endpoint returns one of four response types:
 *   - "oauth"            → auth code returned (exchange for tokens)
 *   - "requires_auth"    → redirect URL provided (open browser)
 *   - "needs_information" → missing required fields (re-prompt)
 *   - "error"            → server error
 */

import * as crypto from 'node:crypto';
import axios from 'axios';
import { z } from 'zod';
import {
  AMPLITUDE_ZONE_SETTINGS,
  OAUTH_PORT,
  OUTBOUND_URLS,
  type AmplitudeZone,
} from '../lib/constants.js';
import type { AmplitudeUserInfo } from '../lib/api.js';
import { type OAuthTokenResponse, exchangeCodeForToken } from './oauth.js';
import { logToFile } from './debug.js';

// ── Endpoint URL ────────────────────────────────────────────────────

const HEADLESS_PROVISIONING_PATH =
  '/t/headless/provisioning/link-or-create-account';

const REDIRECT_URI = `http://localhost:${OAUTH_PORT}/callback`;

function headlessSignupUrl(zone: AmplitudeZone): string {
  return `${OUTBOUND_URLS.app[zone]}${HEADLESS_PROVISIONING_PATH}`;
}

// ── Response schemas ────────────────────────────────────────────────

const OAuthResponse = z.object({
  type: z.literal('oauth'),
  oauth: z.object({ code: z.string() }),
});

const RequiresAuthResponse = z.object({
  type: z.literal('requires_auth'),
  requires_auth: z.object({
    type: z.literal('redirect'),
    redirect: z.object({ url: z.string() }),
  }),
});

const NeedsInformationResponse = z.object({
  type: z.literal('needs_information'),
  needs_information: z.object({ schema: z.record(z.string(), z.unknown()) }),
});

const ErrorResponse = z.object({
  type: z.literal('error'),
  error: z.object({ code: z.string(), message: z.string() }),
});

const HeadlessProvisioningResponse = z.discriminatedUnion('type', [
  OAuthResponse,
  RequiresAuthResponse,
  NeedsInformationResponse,
  ErrorResponse,
]);

// ── Public result type ──────────────────────────────────────────────

export type HeadlessSignupResult =
  | { type: 'oauth'; code: string; state: string }
  | { type: 'requires_auth'; redirectUrl: string }
  | { type: 'needs_information'; schema: Record<string, unknown> }
  | { type: 'error'; code: string; message: string };

export type { OAuthTokenResponse };

// ── Main entry point ────────────────────────────────────────────────

/**
 * Call the headless provisioning endpoint to create a new account
 * or detect an existing user.
 */
export async function performHeadlessSignup(options: {
  email: string;
  fullName: string;
  zone: AmplitudeZone;
}): Promise<HeadlessSignupResult> {
  const { email, fullName, zone } = options;
  const { oAuthClientId } = AMPLITUDE_ZONE_SETTINGS[zone];
  const state = crypto.randomBytes(16).toString('hex');

  const url = headlessSignupUrl(zone);
  logToFile('[headless-signup] calling provisioning endpoint', {
    url,
    email: email.replace(/(.{2}).*@/, '$1***@'),
    zone,
  });

  try {
    const response = await axios.post(
      url,
      {
        email,
        full_name: fullName,
        scopes: ['openid', 'offline'],
        state,
        client_id: oAuthClientId,
        redirect_uri: REDIRECT_URI,
      },
      { timeout: 15_000 },
    );

    const parsed = HeadlessProvisioningResponse.parse(response.data);

    switch (parsed.type) {
      case 'oauth':
        logToFile('[headless-signup] received oauth response with auth code');
        return { type: 'oauth', code: parsed.oauth.code, state };

      case 'requires_auth':
        logToFile('[headless-signup] requires_auth: redirect received');
        return {
          type: 'requires_auth',
          redirectUrl: parsed.requires_auth.redirect.url,
        };

      case 'needs_information':
        logToFile('[headless-signup] server needs more information');
        return {
          type: 'needs_information',
          schema: parsed.needs_information.schema,
        };

      case 'error':
        logToFile(
          `[headless-signup] server error: ${parsed.error.code} — ${parsed.error.message}`,
        );
        return {
          type: 'error',
          code: parsed.error.code,
          message: parsed.error.message,
        };
    }
  } catch (err) {
    // Timeout — caller should fall back to browser OAuth
    if (axios.isAxiosError(err) && err.code === 'ECONNABORTED') {
      logToFile('[headless-signup] request timed out');
      return { type: 'error', code: 'timeout', message: 'Request timed out' };
    }

    // Handle HTTP errors (4xx/5xx) that may include a structured error body
    if (axios.isAxiosError(err) && err.response?.data) {
      const bodyParse = ErrorResponse.safeParse(err.response.data);
      if (bodyParse.success) {
        return {
          type: 'error',
          code: bodyParse.data.error.code,
          message: bodyParse.data.error.message,
        };
      }
    }

    const message = err instanceof Error ? err.message : 'Unknown error';
    logToFile(`[headless-signup] request failed: ${message}`);
    return { type: 'error', code: 'network_error', message };
  }
}

// ── Complete signup: exchange code, fetch user, persist token ────────

export async function completeSignupTokenExchange(
  code: string,
  zone: AmplitudeZone,
): Promise<{ tokenResponse: OAuthTokenResponse; userInfo: AmplitudeUserInfo }> {
  const tokenResponse = await exchangeHeadlessCode(code, zone);
  const { fetchAmplitudeUser } = await import('../lib/api.js');
  const userInfo = await fetchAmplitudeUser(tokenResponse.id_token, zone);
  const { storeToken } = await import('./ampli-settings.js');
  storeToken(
    {
      id: userInfo.id,
      firstName: userInfo.firstName,
      lastName: userInfo.lastName,
      email: userInfo.email,
      zone,
    },
    {
      accessToken: tokenResponse.access_token,
      idToken: tokenResponse.id_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt: new Date(
        Date.now() + tokenResponse.expires_in * 1000,
      ).toISOString(),
    },
  );
  return { tokenResponse, userInfo };
}

// ── Token exchange (no PKCE) ────────────────────────────────────────

/**
 * Exchange an auth code from the headless provisioning endpoint for
 * OAuth tokens. Delegates to the shared exchangeCodeForToken without
 * a PKCE code_verifier (the code was generated server-side).
 */
export async function exchangeHeadlessCode(
  code: string,
  zone: AmplitudeZone,
): Promise<OAuthTokenResponse> {
  return exchangeCodeForToken(code, undefined, zone);
}
