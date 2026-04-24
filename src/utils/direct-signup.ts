import axios from 'axios';
import * as crypto from 'node:crypto';
import { z } from 'zod';
import {
  AMPLITUDE_ZONE_SETTINGS,
  OUTBOUND_URLS,
  OAUTH_PORT,
  type AmplitudeZone,
} from '../lib/constants.js';
import { createLogger } from '../lib/observability/logger.js';

const log = createLogger('direct-signup');

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_EXPIRES_IN_SECONDS = 86_400 * 365;

// Discriminated union response schemas from the provisioning endpoint.
const OAuthCodeSchema = z.object({
  type: z.literal('oauth'),
  oauth: z.object({ code: z.string().min(1) }),
});

const RedirectSchema = z.object({
  type: z.literal('requires_auth'),
  requires_auth: z.object({
    type: z.literal('redirect'),
    redirect: z.object({ url: z.string() }),
  }),
});

const ErrorSchema = z.object({
  type: z.literal('error'),
  error: z.object({ code: z.string(), message: z.string() }),
});

const NeedsInformationSchema = z
  .object({
    type: z.literal('needs_information'),
    needs_information: z
      .object({
        schema: z
          .object({
            required: z.array(z.string()).min(1),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

const TokenSchema = z.object({
  access_token: z.string(),
  id_token: z.string(),
  refresh_token: z.string(),
  token_type: z.string(),
  expires_in: z.number().int().positive().max(MAX_EXPIRES_IN_SECONDS),
});

const OAuthErrorBodySchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
});

function provisioningUrl(zone: AmplitudeZone): string {
  // Dev/testing override — full URL (no /t/ prefix added). Unset in prod.
  const override = process.env.AMPLITUDE_WIZARD_SIGNUP_URL;
  if (override) return override;
  return `${OUTBOUND_URLS.app[zone]}/t/agentic/signup/v1`;
}

export interface DirectSignupInput {
  email: string;
  fullName: string | null;
  zone: AmplitudeZone;
}

export type DirectSignupResult =
  | {
      kind: 'success';
      tokens: {
        accessToken: string;
        idToken: string;
        refreshToken: string;
        expiresAt: string;
        zone: AmplitudeZone;
      };
    }
  | { kind: 'requires_redirect' }
  | { kind: 'needs_information'; requiredFields: string[] }
  | { kind: 'error'; message: string };

/**
 * Attempts to create an Amplitude account and obtain tokens directly via the
 * provisioning endpoint (amplitude/javascript PR #103683). Callers should fall
 * back to the OAuth redirect flow on `requires_redirect` or `error`.
 */
export async function performDirectSignup(
  input: DirectSignupInput,
): Promise<DirectSignupResult> {
  const { oAuthHost, oAuthClientId } = AMPLITUDE_ZONE_SETTINGS[input.zone];
  const url = provisioningUrl(input.zone);
  // The server uses this as the OAuth `confirmationSecret` when issuing the
  // auth code. We send it for server-side correlation; there's no echo to
  // verify against (unlike browser OAuth `state`).
  const state = crypto.randomBytes(16).toString('hex');
  log.debug('[direct-signup] POST', { url, zone: input.zone });

  let response;
  try {
    response = await axios.post(
      url,
      {
        email: input.email,
        scopes: ['openid', 'offline'],
        state,
        client_id: oAuthClientId,
        redirect_uri: `http://localhost:${OAUTH_PORT}/callback`,
        ...(input.fullName !== null ? { full_name: input.fullName } : {}),
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: (s) => s < 500,
      },
    );
  } catch (e) {
    return {
      kind: 'error',
      message: e instanceof Error ? e.message : String(e),
    };
  }

  const parsedRedirect = RedirectSchema.safeParse(response.data);
  if (parsedRedirect.success) return { kind: 'requires_redirect' };

  const parsedNeedsInfo = NeedsInformationSchema.safeParse(response.data);
  if (parsedNeedsInfo.success) {
    return {
      kind: 'needs_information',
      requiredFields: parsedNeedsInfo.data.needs_information.schema.required,
    };
  }

  const parsedError = ErrorSchema.safeParse(response.data);
  if (parsedError.success) {
    return { kind: 'error', message: parsedError.data.error.message };
  }

  const parsedCode = OAuthCodeSchema.safeParse(response.data);
  if (!parsedCode.success) {
    if (response.status === 429) {
      log.warn('[direct-signup] provisioning rate limited');
      return { kind: 'error', message: 'Provisioning rate limited (HTTP 429)' };
    }
    if (response.status >= 400) {
      log.warn('[direct-signup] provisioning client error', {
        status: response.status,
      });
      return {
        kind: 'error',
        message: `Provisioning failed with HTTP ${response.status}`,
      };
    }
    log.error('[direct-signup] unexpected response shape', {
      status: response.status,
    });
    return {
      kind: 'error',
      message: `Unexpected response (${response.status})`,
    };
  }

  // Exchange the auth code for tokens.
  let tokenResponse;
  try {
    tokenResponse = await axios.post(
      `${oAuthHost}/oauth2/token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: parsedCode.data.oauth.code,
        redirect_uri: `http://localhost:${OAUTH_PORT}/callback`,
        client_id: oAuthClientId,
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: (s) => s < 500,
      },
    );
  } catch (e) {
    return {
      kind: 'error',
      message: `Token exchange failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }

  if (tokenResponse.status >= 400) {
    const parsedOAuthError = OAuthErrorBodySchema.safeParse(tokenResponse.data);
    if (parsedOAuthError.success) {
      const { error, error_description } = parsedOAuthError.data;
      const description = error_description ? `: ${error_description}` : '';
      log.warn('[direct-signup] token exchange error', { error });
      return {
        kind: 'error',
        message: `Token exchange ${tokenResponse.status}: ${error}${description}`,
      };
    }
    log.warn('[direct-signup] token exchange failed', {
      status: tokenResponse.status,
    });
    return {
      kind: 'error',
      message: `Token exchange failed (${tokenResponse.status})`,
    };
  }

  const parsedTokens = TokenSchema.safeParse(tokenResponse.data);
  if (!parsedTokens.success) {
    return {
      kind: 'error',
      message: 'Token exchange returned invalid response',
    };
  }

  const expiresAt = new Date(
    Date.now() + parsedTokens.data.expires_in * 1000,
  ).toISOString();
  return {
    kind: 'success',
    tokens: {
      accessToken: parsedTokens.data.access_token,
      idToken: parsedTokens.data.id_token,
      refreshToken: parsedTokens.data.refresh_token,
      expiresAt,
      zone: input.zone,
    },
  };
}
