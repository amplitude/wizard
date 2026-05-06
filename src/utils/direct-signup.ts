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
// `dashboard_url` — optional magic-link URL (amplitude/javascript PR #108967).
const OAuthProvisioningSchema = z.object({
  type: z.literal('oauth'),
  oauth: z.object({ code: z.string().min(1) }),
  // `.nullish()` (no `min(1)`): a metadata field with strict validation
  // would fail-closed the entire signup whenever the API returns an empty
  // string or null. Treat empty as null at the read site.
  dashboard_url: z.string().nullish(),
});

const RedirectSchema = z.object({
  type: z.literal('requires_auth'),
  requires_auth: z.object({
    type: z.literal('redirect'),
    redirect: z.object({ url: z.string() }),
  }),
});

// JSON-Schema-shaped payload from the server. We only consume `required` to
// know which fields to collect next; `properties` is preserved as opaque so a
// future server-side addition (e.g. a new field with extra metadata) doesn't
// fail-closed the parse.
//
// The server wraps the JSON-Schema in an extra `schema` field — verified via
// direct curl against `https://app.amplitude.com/t/agentic/signup/v1`:
//
//   { "type": "needs_information",
//     "needs_information": {
//       "schema": {
//         "type": "object",
//         "properties": { "full_name": { ... } },
//         "required": ["full_name"]
//       }
//     } }
//
// An earlier version put `type`/`properties`/`required` directly on
// `needs_information`, which made every probe POST fall through to the
// generic "unrecognized response shape" error and silently route users to
// OAuth.
//
// **Wire contract:** the `properties` map's VALUES are opaque to the wizard.
// `z.unknown()` is intentional — the server today emits
// `{ type, description }` per property, but `description` is purely cosmetic
// and may be removed (or any other inner field added) without coordination.
// Do NOT tighten the inner shape without verifying every `selectModel`-mode
// can still parse a response from the live server. There's a regression
// test (`accepts properties values with or without optional metadata`) that
// pins both shapes; keep it green if you change this.
const NeedsInformationSchema = z.object({
  type: z.literal('needs_information'),
  needs_information: z.object({
    schema: z.object({
      type: z.literal('object'),
      properties: z.record(z.string(), z.unknown()),
      required: z.array(z.string()).min(1),
    }),
  }),
});

const ErrorSchema = z.object({
  type: z.literal('error'),
  error: z.object({ code: z.string(), message: z.string() }),
});

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
  /**
   * Optional. Omit on the probe POST so the server can decide whether the
   * account is new (→ `needs_information`) or already exists (→ redirect).
   * Required on the follow-up POST when the wizard has collected the field
   * the server asked for.
   */
  fullName?: string;
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
      /** From `dashboard_url`; may contain secrets — never log or NDJSON. */
      dashboardUrl: string | null;
    }
  | { kind: 'requires_redirect' }
  | { kind: 'needs_information'; requiredFields: string[] }
  | { kind: 'error'; message: string; code?: string };

/**
 * Attempts to create an Amplitude account and obtain tokens directly via the
 * provisioning endpoint (amplitude/javascript PR #103683). Callers should:
 * - on `success`: store tokens and continue.
 * - on `needs_information`: collect the requested field(s) and call again
 *   with `fullName` populated.
 * - on `requires_redirect` or `error`: fall back to the OAuth redirect flow.
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

  // Build the request body conditionally — omit `full_name` entirely when
  // unset, instead of sending it as an empty string. The server treats
  // `!body.full_name` as "no name provided" and responds `needs_information`;
  // sending `""` would either be rejected by the server's zod (`min(1)`)
  // or — worse, depending on coercion — be accepted as a valid name.
  const requestBody: Record<string, unknown> = {
    email: input.email,
    scopes: ['openid', 'offline'],
    state,
    client_id: oAuthClientId,
    redirect_uri: `http://localhost:${OAUTH_PORT}/callback`,
  };
  if (input.fullName !== undefined && input.fullName.length > 0) {
    requestBody.full_name = input.fullName;
  }

  let response;
  try {
    response = await axios.post(url, requestBody, {
      headers: { 'Content-Type': 'application/json' },
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: (s) => s < 500,
    });
  } catch (e) {
    return {
      kind: 'error',
      message: e instanceof Error ? e.message : String(e),
    };
  }

  const parsedRedirect = RedirectSchema.safeParse(response.data);
  if (parsedRedirect.success) return { kind: 'requires_redirect' };

  const parsedNeeds = NeedsInformationSchema.safeParse(response.data);
  if (parsedNeeds.success) {
    return {
      kind: 'needs_information',
      requiredFields: parsedNeeds.data.needs_information.schema.required,
    };
  }

  const parsedError = ErrorSchema.safeParse(response.data);
  if (parsedError.success) {
    return {
      kind: 'error',
      message: parsedError.data.error.message,
      code: parsedError.data.error.code,
    };
  }

  const parsedCode = OAuthProvisioningSchema.safeParse(response.data);
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

  // Source `expiresAt` from id_token's exp claim (id_token TTL is the
  // binding constraint for API calls). Falls back to `expires_in` and
  // then to a 1-hour default if either is unusable. See
  // `src/utils/jwt-exp.ts` for rationale.
  const { resolveStoredExpiryMs } = await import('./jwt-exp.js');
  const expiresAt = new Date(
    resolveStoredExpiryMs({
      idToken: parsedTokens.data.id_token,
      expiresInSeconds: parsedTokens.data.expires_in,
    }),
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
    // Coerce empty-string to null so downstream code (which displays the
    // URL or short-circuits on missing) doesn't have to handle "" as a
    // distinct third case.
    dashboardUrl: parsedCode.data.dashboard_url || null,
  };
}
