import axios from 'axios';
import * as crypto from 'node:crypto';
import { z } from 'zod';
import {
  AMPLITUDE_ZONE_SETTINGS,
  OUTBOUND_URLS,
  OAUTH_PORT,
  PRIVACY_POLICY_URL,
  TERMS_OF_SERVICE_URL,
  type AmplitudeZone,
} from '../lib/constants.js';
import { createLogger } from '../lib/observability/logger.js';

const log = createLogger('direct-signup');

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_EXPIRES_IN_SECONDS = 86_400 * 365;

/**
 * The fields the wizard knows how to satisfy when listed in
 * `needs_information.required`. Drives the schema's refine AND consumers
 * that exhaustively switch on a kind (e.g. `flows.ts` `requiredSatisfied`).
 * Adding a new kind here is the single source-of-truth change that
 * propagates through the parser, the flow predicate, and any other
 * consumer via `tsc` errors at unhandled call sites.
 */
export const KNOWN_REQUIRED_KEYS = ['full_name', 'terms_acceptance'] as const;
export type RequiredKey = (typeof KNOWN_REQUIRED_KEYS)[number];

/**
 * Legal document kinds the wizard knows how to render. Same source-of-truth
 * pattern as KNOWN_REQUIRED_KEYS — the schema's enum and the screen's
 * iteration both derive from this const.
 */
export const KNOWN_DOC_KINDS = ['terms_of_service', 'privacy_policy'] as const;
export type DocKind = (typeof KNOWN_DOC_KINDS)[number];

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
//
// **Supported `required` shape:** any non-empty subset of
// `KNOWN_REQUIRED_KEYS`. Anything else (unknown kinds, empty array) fails
// the parse and we route through the type-aware handler below to
// `kind: 'error'` with `code: 'unsupported_required_shape'`. That code maps
// to a distinct `needs_information_unsupported` telemetry status in the
// wrapper so the drift is visible in the funnel before users notice.
const NeedsInformationSchema = z.object({
  type: z.literal('needs_information'),
  needs_information: z.object({
    schema: z.object({
      type: z.literal('object'),
      properties: z.record(z.string(), z.unknown()),
      required: z.array(z.enum(KNOWN_REQUIRED_KEYS)).nonempty(),
    }),
  }),
});

// Validates AND emits the keyed shape for `terms_acceptance.documents` in
// one pass via `.transform()`. Output is `{ terms_of_service, privacy_policy }`
// directly — no `.find()` ceremony at the call site.
const DocumentEntrySchema = z.object({
  kind: z.enum(KNOWN_DOC_KINDS),
  url: z.string().url(),
});

const TermsAcceptanceDocsSchema = z
  .array(DocumentEntrySchema)
  .length(2)
  .transform((docs, ctx) => {
    const map: Partial<Record<DocKind, string>> = {};
    for (const d of docs) map[d.kind] = d.url;
    if (!map.terms_of_service || !map.privacy_policy) {
      // ctx = zod RefinementCtx; addIssue + z.NEVER short-circuits the
      // transform and surfaces the failure at the parent safeParse.
      ctx.addIssue({ code: 'custom', message: 'unsupported_required_shape' });
      return z.NEVER;
    }
    return {
      terms_of_service: map.terms_of_service,
      privacy_policy: map.privacy_policy,
    };
  });

const ErrorSchema = z.object({
  type: z.literal('error'),
  error: z.object({ code: z.string(), message: z.string() }),
});

// Narrow `response.data` (typed as `any` by axios) to "an object with a
// `type` field" without an `as` cast — zod handles the unknown → typed
// value safely. Used by the unsupported-shape fall-through.
const ResponseTypeSchema = z.object({ type: z.string() }).passthrough();

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

function isCallerAbort(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (axios.isCancel(error)) return true;
  if (error instanceof Error) {
    const maybeCode = (error as Error & { code?: string }).code;
    return (
      error.name === 'AbortError' ||
      error.name === 'CanceledError' ||
      maybeCode === 'ERR_CANCELED'
    );
  }
  return false;
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
  /**
   * Aborts both the provisioning POST and the token-exchange POST when
   * fired. Threaded from the screen's `useAsyncEffect` so unmounting
   * (Esc back, /exit, navigation) cancels in-flight network work
   * before it can settle and trigger downstream side effects (token
   * persistence). Without this, a cancelled ceremony can still leak
   * `replaceStoredUser` writes that make the next launch think the
   * user is signed in.
   */
  signal?: AbortSignal;
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
  | {
      kind: 'needs_information';
      requiredFields: RequiredKey[];
      /**
       * URLs of the legal documents the user must accept. Populated under
       * the spoof in Phase A whenever `'terms_acceptance' in requiredFields`.
       * Nullable on type to accommodate Phase D (BE drops the requirement)
       * — at that point the screen-show predicate evaluates false and ToS
       * is naturally skipped.
       */
      legalDocumentBundle: {
        terms_of_service: string;
        privacy_policy: string;
      } | null;
      /**
       * Where `legalDocumentBundle`'s URLs originated — `'server'` when BE
       * provided them in `needs_information.terms_acceptance.documents`,
       * `'local'` when the parser's spoof block synthesized them from
       * local constants. Used as the value of the `'legal document source'`
       * telemetry tag.
       */
      legalDocumentSource: 'server' | 'local';
    }
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
      signal: input.signal,
    });
  } catch (e) {
    if (isCallerAbort(e, input.signal)) {
      return { kind: 'error', message: 'aborted', code: 'aborted' };
    }
    return {
      kind: 'error',
      message: e instanceof Error ? e.message : String(e),
    };
  }
  // Bail before parsing if the caller aborted between sending the
  // request and receiving the response. The screen's `useAsyncEffect`
  // unmount handler fires the AbortController; without this guard we'd
  // continue on to token exchange and potential persistence even though
  // the user has navigated away.
  if (input.signal?.aborted) {
    return { kind: 'error', message: 'aborted', code: 'aborted' };
  }

  const parsedRedirect = RedirectSchema.safeParse(response.data);
  if (parsedRedirect.success) return { kind: 'requires_redirect' };

  const parsedNeeds = NeedsInformationSchema.safeParse(response.data);
  if (parsedNeeds.success) {
    const requiredFromBE = parsedNeeds.data.needs_information.schema.required;
    const requiredHasTerms = requiredFromBE.includes('terms_acceptance');

    // Pull `documents` out of `properties.terms_acceptance` defensively —
    // the wire contract keeps property values opaque (z.unknown), so we
    // walk the shape with `in`-narrowing rather than tightening the schema.
    const propsRaw = parsedNeeds.data.needs_information.schema.properties;
    const termsPropertyRaw = propsRaw['terms_acceptance'];
    const documentsRaw =
      typeof termsPropertyRaw === 'object' &&
      termsPropertyRaw !== null &&
      'documents' in termsPropertyRaw
        ? termsPropertyRaw.documents
        : undefined;
    const termsParse = TermsAcceptanceDocsSchema.safeParse(documentsRaw);

    // Invariant violation: BE listed terms_acceptance as required but
    // documents are missing or malformed. Treat as unsupported.
    if (requiredHasTerms && !termsParse.success) {
      log.warn(
        '[direct-signup] needs_information with required terms_acceptance but invalid documents',
      );
      return {
        kind: 'error',
        code: 'unsupported_required_shape',
        message:
          'Server returned terms_acceptance in required without valid documents — falling back to browser auth.',
      };
    }

    let legalDocumentBundle: {
      terms_of_service: string;
      privacy_policy: string;
    } | null;
    let legalDocumentSource: 'server' | 'local';
    let normalizedRequired: RequiredKey[] = [...requiredFromBE];

    if (requiredHasTerms && termsParse.success) {
      // Case (b) — BE provided. termsParse.data is the typed keyed record
      // from TermsAcceptanceDocsSchema's .transform().
      legalDocumentBundle = termsParse.data;
      legalDocumentSource = 'server';
    } else {
      // === SPOOF BLOCK — DELETE WHEN REMOVING LOCAL FALLBACK ===
      // Case (a) — BE flag OFF. Synthesize local URLs and inject
      // 'terms_acceptance' into requiredFields so downstream sees
      // case (a) and case (b) as the same shape. The screen, the body
      // construction, the flow predicates — none of them branch on BE
      // flag state. When the BE flag is ON across env tiers and adoption
      // telemetry confirms it's safe, this entire `else` branch is what
      // the cleanup PR deletes — no downstream changes required.
      legalDocumentBundle = {
        terms_of_service: TERMS_OF_SERVICE_URL,
        privacy_policy: PRIVACY_POLICY_URL,
      };
      legalDocumentSource = 'local';
      normalizedRequired = [...requiredFromBE, 'terms_acceptance'];
      // === END SPOOF BLOCK ===
    }

    return {
      kind: 'needs_information',
      requiredFields: normalizedRequired,
      legalDocumentBundle,
      legalDocumentSource,
    };
  }
  // The schema rejected the `required` shape (unknown kind, empty array, or
  // some other contract drift). Detect this here — by peeking at the
  // response's `type` field — so we can return a distinct error code instead
  // of falling through to the generic "Unexpected response" path. The
  // wrapper maps `code: 'unsupported_required_shape'` to
  // `needs_information_unsupported` telemetry so the wire-contract drift is
  // visible in the funnel.
  const typedResponse = ResponseTypeSchema.safeParse(response.data);
  const responseType = typedResponse.success
    ? typedResponse.data.type
    : undefined;
  if (responseType === 'needs_information') {
    log.warn('[direct-signup] needs_information with unsupported shape', {
      knownKeys: KNOWN_REQUIRED_KEYS,
    });
    return {
      kind: 'error',
      code: 'unsupported_required_shape',
      message:
        'Server requested fields the wizard does not support — falling back to browser auth.',
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
        signal: input.signal,
      },
    );
  } catch (e) {
    if (isCallerAbort(e, input.signal)) {
      return { kind: 'error', message: 'aborted', code: 'aborted' };
    }
    return {
      kind: 'error',
      message: `Token exchange failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }
  // Same abort check as after the provisioning POST: skip downstream
  // parsing if the caller backed out while we were waiting on Hydra.
  if (input.signal?.aborted) {
    return { kind: 'error', message: 'aborted', code: 'aborted' };
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
