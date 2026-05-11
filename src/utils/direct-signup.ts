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

/**
 * Map of legal-doc kind → URL. Shared across the wire boundary
 * (`needs_information` parser, signup-or-auth wrapper, session) and the
 * follow-up POST body builder. Adding a new `DocKind` propagates here
 * automatically via tsc.
 */
export type LegalDocumentBundle = Record<DocKind, string>;

/**
 * Where a `LegalDocumentBundle`'s URLs originated:
 * `'server'` — BE-supplied via `needs_information.terms_acceptance.documents`.
 * `'local'` — synthesized from local constants by the parser's spoof block.
 */
export type LegalDocumentSource = 'server' | 'local';

// === SPOOF — DELETE WHEN REMOVING LOCAL FALLBACK ===
// Local URLs the parser substitutes when the BE flag is OFF. Keyed by
// DocKind so adding a new kind propagates here via tsc.
const LOCAL_DOC_URLS: LegalDocumentBundle = {
  terms_of_service: TERMS_OF_SERVICE_URL,
  privacy_policy: PRIVACY_POLICY_URL,
};

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

/**
 * Discriminated input to `performDirectSignup`.
 *
 * - `kind: 'initial'` — the wizard hasn't heard from the BE yet during
 *   this ceremony. Body carries only `email` (plus envelope fields).
 *   The BE decides what's needed and responds `needs_information`,
 *   `requires_redirect` (existing user), or `oauth` (success).
 *
 * - `kind: 'follow_up'` — the wizard received `needs_information` on a
 *   prior call, the user has now satisfied every required field, and
 *   we're submitting the complete body. `fullName` and
 *   `legalDocumentBundle` are both required at the type level — the
 *   discriminated union enforces that callers can't construct a
 *   `'follow_up'` shape without all of them.
 *
 * Why this is binary: the wizard's flow gate (`requiredSatisfied` in
 * `flows.ts`) prevents `SigningUp` from re-firing until every required
 * field is collected. There's no "I have full_name but not yet
 * terms_acceptance" intermediate state that hits the network — re-fires
 * only happen after all required fields are filled.
 */
export type DirectSignupInput =
  | {
      kind: 'initial';
      email: string;
      zone: AmplitudeZone;
      /**
       * Aborts both the provisioning POST and the token-exchange POST
       * when fired. Threaded from the screen's `useAsyncEffect` so
       * unmounting (Esc back, /exit, navigation) cancels in-flight
       * network work before it can settle and trigger downstream side
       * effects (token persistence). Without this, a cancelled ceremony
       * can still leak `replaceStoredUser` writes that make the next
       * launch think the user is signed in.
       */
      signal?: AbortSignal;
    }
  | {
      kind: 'follow_up';
      email: string;
      fullName: string;
      legalDocumentBundle: LegalDocumentBundle;
      zone: AmplitudeZone;
      signal?: AbortSignal;
    };

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
       * Legal-doc URLs. Nullable so the BE can drop the requirement
       * later — at that point the ToS-show predicate evaluates false and
       * the screen is naturally skipped.
       */
      legalDocumentBundle: LegalDocumentBundle | null;
      /** Source feeds the `'legal document source'` telemetry tag. */
      legalDocumentSource: LegalDocumentSource;
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
  log.debug('[direct-signup] POST', {
    url,
    zone: input.zone,
    kind: input.kind,
  });

  // Build the request body via discriminated switch — `'initial'` shapes
  // produce the bare envelope, `'follow_up'` shapes add `full_name` and
  // `terms_acceptance`. The type system enforces "follow_up always has
  // both collected fields" at the call site, so the body construction
  // here doesn't need runtime guards on optional fields.
  const baseBody = {
    email: input.email,
    scopes: ['openid', 'offline'],
    state,
    client_id: oAuthClientId,
    redirect_uri: `http://localhost:${OAUTH_PORT}/callback`,
  };

  const requestBody: Record<string, unknown> =
    input.kind === 'initial'
      ? baseBody
      : {
          ...baseBody,
          full_name: input.fullName,
          terms_acceptance: {
            terms_of_service: {
              url: input.legalDocumentBundle.terms_of_service,
              accepted: true,
            },
            privacy_policy: {
              url: input.legalDocumentBundle.privacy_policy,
              accepted: true,
            },
          },
        };

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

    let legalDocumentBundle: LegalDocumentBundle | null;
    let legalDocumentSource: LegalDocumentSource;
    let normalizedRequired: RequiredKey[] = [...requiredFromBE];

    if (requiredHasTerms && termsParse.success) {
      legalDocumentBundle = termsParse.data;
      legalDocumentSource = 'server';
    } else {
      // === SPOOF — DELETE WHEN REMOVING LOCAL FALLBACK ===
      // BE flag OFF: synthesize URLs and inject 'terms_acceptance' so
      // downstream sees the same shape as the BE-supplied case. When the
      // flag is ON across env tiers, the entire `else` branch is what the
      // cleanup PR deletes — no downstream changes required.
      legalDocumentBundle = LOCAL_DOC_URLS;
      legalDocumentSource = 'local';
      normalizedRequired = [...requiredFromBE, 'terms_acceptance'];
      // === END SPOOF ===
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
