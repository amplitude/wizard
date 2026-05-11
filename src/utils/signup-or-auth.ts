import type { AmplitudeAuthResult } from './oauth.js';
import {
  performDirectSignup,
  type DirectSignupInput,
  type RequiredKey,
  type LegalDocumentBundle,
  type LegalDocumentSource,
  type SignupShape,
} from './direct-signup.js';
import { replaceStoredUser, type StoredUser } from './ampli-settings.js';
import { fetchAmplitudeUser, type AmplitudeUserInfo } from '../lib/api.js';
import { createLogger } from '../lib/observability/logger.js';
import type { AmplitudeZone } from '../lib/constants.js';
import { analytics } from './analytics.js';
import { assertNever } from './assert-never.js';

const log = createLogger('signup-or-auth');

// Retry delays for post-signup provisioning: worst-case total wait ~3.5s.
const PROVISIONING_RETRY_DELAYS_MS = [500, 1000, 2000];

function hasEnvWithApiKey(userInfo: AmplitudeUserInfo): boolean {
  return userInfo.orgs.some((org) =>
    org.projects.some((proj) =>
      (proj.environments ?? []).some((e) => e.app?.apiKey),
    ),
  );
}

type FetchUserResult =
  | {
      ok: true;
      userInfo: AmplitudeUserInfo;
      retryCount: number;
      hasEnvWithApiKey: boolean;
    }
  | { ok: false; retryCount: number; error: unknown };

/**
 * After a successful direct signup, the backend may not have finished
 * provisioning the default org/workspace/environment. Retry the user
 * fetch a few times so downstream credential resolution finds an env
 * with a project API key, instead of mis-reporting "no_stored_credentials".
 *
 * Retries on both "returned but no env with apiKey" and "threw" — the
 * Data API throws "No user data returned" when orgs is empty, which is
 * the most-likely brand-new-signup race condition. Returns a discriminated
 * union so the caller can drive telemetry (retry count, env-with-apikey
 * flag) without duplicating try/catch. Never throws.
 */
async function fetchUserWithProvisioningRetry(
  idToken: string,
  zone: AmplitudeZone,
): Promise<FetchUserResult> {
  let userInfo: AmplitudeUserInfo | null = null;
  let lastError: unknown = null;
  let retryCount = 0;
  try {
    userInfo = await fetchAmplitudeUser(idToken, zone);
  } catch (err) {
    lastError = err;
  }
  for (const delayMs of PROVISIONING_RETRY_DELAYS_MS) {
    if (userInfo && hasEnvWithApiKey(userInfo)) {
      return { ok: true, userInfo, retryCount, hasEnvWithApiKey: true };
    }
    log.debug('signup provisioning incomplete; retrying user fetch', {
      delayMs,
      threw: lastError !== null,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    retryCount += 1;
    try {
      userInfo = await fetchAmplitudeUser(idToken, zone);
      lastError = null;
    } catch (err) {
      // Keep any prior successful userInfo — losing it here would make us
      // fall back to the pending sentinel when we already have real user
      // data from an earlier attempt that just didn't yet have an env.
      lastError = err;
    }
  }
  if (userInfo) {
    const hasEnv = hasEnvWithApiKey(userInfo);
    if (!hasEnv) {
      log.warn('signup user has no env with apiKey after retries', {
        zone,
        orgs: userInfo.orgs.length,
      });
    }
    return {
      ok: true,
      userInfo,
      retryCount,
      hasEnvWithApiKey: hasEnv,
    };
  }
  return { ok: false, retryCount, error: lastError };
}

export type SignupAttemptStatus =
  | 'success'
  | 'requires_redirect'
  | 'needs_information'
  /**
   * Server returned `needs_information` with a `required` shape the wizard
   * doesn't know how to collect (anything other than exactly `['full_name']`
   * — including unknown new fields, an empty array, or a mix with unknown
   * fields). Treated as a terminal abandon → user falls back to OAuth.
   * Distinct from `signup_error` so the wire-contract drift is visible in
   * the funnel — if this status starts firing, the server has added a
   * required field the wizard doesn't yet handle.
   */
  | 'needs_information_unsupported'
  | 'signup_error'
  | 'user_fetch_failed'
  | 'wrapper_exception'
  /**
   * Direct signup produced fresh tokens, but the caller's downstream
   * `fetchAmplitudeUser` still failed and it opened a browser OAuth flow
   * to recover. Distinguishes this rare edge case from a primary-path
   * browser OAuth (which never fires this event).
   */
  | 'browser_fallback_after_signup';

export const AGENTIC_SIGNUP_ATTEMPTED_EVENT = 'agentic signup attempted';

export type AgenticSignupAttemptedProperties = {
  status: SignupAttemptStatus;
  zone: AmplitudeZone;
  'has env with api key'?: boolean;
  'user fetch retry count'?: number;
  /**
   * Where the legal-document URLs that informed this attempt's
   * `terms_acceptance` slot came from. `'unused'` covers attempts whose
   * body carried no `terms_acceptance` (probe POST, existing-user
   * redirect, error before terms collection). Set on every status arm so
   * dashboards can slice adoption by URL source and tie it to the
   * eventual outcome.
   */
  'legal document source'?: LegalDocumentSource | 'unused';
};

export const trackSignupAttempt = (
  properties: AgenticSignupAttemptedProperties,
): void => {
  analytics.wizardCapture(AGENTIC_SIGNUP_ATTEMPTED_EVENT, properties);
};

/**
 * Wrapper input — same shape as `DirectSignupInput`, only `email` may be
 * `null`. Both types instantiate `SignupShape<Email>` so the relationship
 * is structural: a future field added to one auto-applies to the other,
 * and the `{ ...input, email: input.email }` pass-through in
 * `performSignupOrAuth` stays sound by construction. The wrapper
 * short-circuits to a `'missing email'` error before reaching
 * `performDirectSignup`, so the underlying call always sees a non-null
 * email.
 *
 * The screen at the call site (`SigningUpScreen.tsx`) decides which kind
 * to build based on `session.signupRequiredFields !== null` (BE-driven:
 * has the BE returned `needs_information` at least once during this
 * ceremony?). Data-completeness is enforced separately by the flow gate
 * (`requiredSatisfied` in `flows.ts`) — by the time SigningUp re-fires,
 * every required field is collected.
 */
export type SignupOrAuthInput = SignupShape<string | null>;

/**
 * Discriminated-union result of {@link performSignupOrAuth}.
 *
 * - `success` — server returned `oauth`; tokens are valid and the wrapper
 *   already fetched the real user profile (with provisioning retry) and
 *   persisted it to `~/.ampli.json`.
 * - `needs_information` — server returned `needs_information`; the caller
 *   should collect the listed fields and call again. No tokens, no
 *   persistence side-effects.
 * - `redirect` — server returned `requires_auth` (existing user OR feature
 *   flag off). Caller should fall back to browser OAuth.
 * - `error` — direct-signup network call errored, the response shape was
 *   malformed, or the server returned an `error` arm. Caller decides
 *   whether to fall back to OAuth or hard-fail.
 */
export type PerformSignupOrAuthResult =
  | (AmplitudeAuthResult & {
      kind: 'success';
      userInfo: AmplitudeUserInfo | null;
      /**
       * Provisioning `dashboard_url` (browser magic link). May contain
       * secrets — do not log or emit on NDJSON.
       */
      dashboardUrl: string | null;
    })
  | {
      kind: 'needs_information';
      requiredFields: RequiredKey[];
      /**
       * Legal-doc URLs the parser produced. Caller writes this into
       * `session.legalDocumentBundle` so the ToS screen and the follow-up
       * POST body both pull from one place.
       */
      legalDocumentBundle: LegalDocumentBundle | null;
      /**
       * Caller writes this into `session.legalDocumentSource` so
       * subsequent telemetry arms can read the source without
       * re-threading it through the wrapper.
       */
      legalDocumentSource: LegalDocumentSource;
    }
  | { kind: 'redirect' }
  | { kind: 'error'; message: string };

/**
 * Attempt direct signup via the headless provisioning endpoint.
 *
 * `email` is required (the only required input). `fullName` is optional —
 * omit it on the probe POST so the server can route a brand-new email to
 * `needs_information` (the TUI then collects the field and calls again
 * with `fullName` populated). Non-TUI callers (CI / agent / classic) gate
 * on both being present upstream and never hit the `needs_information`
 * arm in practice.
 *
 * On `success`, also fetches the real user profile and persists the
 * `StoredUser` + tokens to `~/.ampli.json` so downstream
 * `resolveCredentials()` can populate `session.credentials` via the
 * standard path. Falls back to the `id:'pending'` sentinel if the user
 * fetch fails. The user fetch retries briefly on the "no env with API key
 * yet" case to absorb post-signup provisioning lag.
 *
 * This function does NOT fall back to `performAmplitudeAuth()`. Callers
 * that want OAuth fallback (e.g. the TUI path on `redirect` / `error`)
 * must call it explicitly. Agent/CI modes typically skip OAuth and let
 * `resolveNonInteractiveCredentials` handle cached-token resolution.
 */
export async function performSignupOrAuth(
  input: SignupOrAuthInput,
): Promise<PerformSignupOrAuthResult> {
  if (input.email === null) {
    log.debug('missing email; skipping direct signup');
    return { kind: 'error', message: 'missing email' };
  }
  // SignupOrAuthInput differs from DirectSignupInput only in email's
  // nullability. After the guard above, narrow via spread + explicit
  // email — performDirectSignup builds the body via its own switch.
  const directSignupInput: DirectSignupInput = { ...input, email: input.email };

  // Source tag for the `'legal document source'` telemetry property,
  // derived from what the attempt's body WILL carry:
  //   - 'follow_up' input → URLs in body → use the source the parser
  //     recorded (passed in via input.legalDocumentSource).
  //   - 'initial' input → body has no terms_acceptance slot → 'unused'.
  // The `needs_information` arm overrides this with `result.legalDocumentSource`
  // because that arm reports what BE produced, not what the caller sent.
  const inputSource: LegalDocumentSource | 'unused' =
    input.kind === 'follow_up' ? input.legalDocumentSource : 'unused';

  log.debug('attempting direct signup', { kind: input.kind });
  // performDirectSignup is contracted to catch its own network/parse errors
  // and return { kind: 'error' }. The try/catch here is belt-and-suspenders
  // enforcement against an unexpected throw — emit `wrapper_exception`
  // telemetry so a thrown error is distinguishable from a clean error arm.
  let result: Awaited<ReturnType<typeof performDirectSignup>>;
  try {
    result = await performDirectSignup(directSignupInput);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('direct signup threw unexpectedly', { message });
    trackSignupAttempt({
      status: 'wrapper_exception',
      zone: input.zone,
      'legal document source': inputSource,
    });
    return { kind: 'error', message };
  }

  // Exhaustive switch on the direct-signup result. `default: assertNever`
  // makes a future arm a compile error — the wrapper is the closest
  // layer to the wire and a silent fall-through into the success path
  // below would attempt to read `result.tokens` on a shape that doesn't
  // have it. TS narrowing already protects us here, but matching the
  // explicit pattern used at SigningUpScreen.tsx and runDirectSignupIfRequested
  // keeps the contract uniform across all consumers of DirectSignupResult.
  switch (result.kind) {
    case 'requires_redirect':
      log.debug('direct signup → redirect');
      trackSignupAttempt({
        status: 'requires_redirect',
        zone: input.zone,
        // Existing-user redirect path. For initial-kind probes, body
        // carried no terms_acceptance → 'unused'. For follow_up calls
        // that get redirected (e.g. an existing-user email surfaces
        // late), body did carry terms_acceptance from the input's
        // source — pass that through.
        'legal document source': inputSource,
      });
      return { kind: 'redirect' };
    case 'needs_information':
      log.debug('direct signup → needs_information', {
        requiredFields: result.requiredFields,
        legalDocumentSource: result.legalDocumentSource,
      });
      trackSignupAttempt({
        status: 'needs_information',
        zone: input.zone,
        'legal document source': result.legalDocumentSource,
      });
      return {
        kind: 'needs_information',
        requiredFields: result.requiredFields,
        legalDocumentBundle: result.legalDocumentBundle,
        legalDocumentSource: result.legalDocumentSource,
      };
    case 'error': {
      log.debug('direct signup → error', {
        message: result.message,
        code: result.code,
      });
      // Caller cancelled the in-flight request (Esc, /exit, screen
      // unmount). Surface as a clean `error` arm but don't emit
      // signup_error telemetry — user-initiated aborts aren't funnel
      // failures and would inflate signup_error counts otherwise.
      if (result.code === 'aborted') {
        return { kind: 'error', message: result.message };
      }
      // The schema's `.refine()` on `required` rejects shapes the wizard
      // can't act on, and `direct-signup.ts` surfaces that with
      // `code: 'unsupported_required_shape'`. Emit a distinct telemetry
      // status so the wire-contract drift is visible separately from
      // generic signup errors — one funnel query reveals when the server
      // adds a required field the wizard doesn't yet handle.
      const status: SignupAttemptStatus =
        result.code === 'unsupported_required_shape'
          ? 'needs_information_unsupported'
          : 'signup_error';
      trackSignupAttempt({
        status,
        zone: input.zone,
        // Source comes from the input — `initial` calls had no
        // terms_acceptance in the body ('unused'), `follow_up` calls
        // had it from whichever source the parser recorded.
        'legal document source': inputSource,
      });
      return { kind: 'error', message: result.message };
    }
    case 'success':
      // Fall through to the persistence + user-fetch block below.
      break;
    default:
      assertNever(result);
  }

  const tokens = {
    accessToken: result.tokens.accessToken,
    idToken: result.tokens.idToken,
    refreshToken: result.tokens.refreshToken,
    expiresAt: result.tokens.expiresAt,
  };

  // Fetch the real user profile so resolveCredentials() downstream can find
  // a non-pending stored user with a valid zone. Fall back to the pending
  // sentinel on fetch failure — the next wizard run will patch the entry.
  // The fetch retries briefly on the "no env with API key yet" case to
  // absorb post-signup provisioning lag.
  let userInfo: AmplitudeUserInfo | null = null;
  let user: StoredUser;
  const fetchResult = await fetchUserWithProvisioningRetry(
    tokens.idToken,
    input.zone,
  );
  if (fetchResult.ok) {
    userInfo = fetchResult.userInfo;
    user = {
      id: userInfo.id,
      firstName: userInfo.firstName,
      lastName: userInfo.lastName,
      email: userInfo.email,
      zone: input.zone,
    };
  } else {
    log.warn(
      'fetchAmplitudeUser failed after direct signup; falling back to pending sentinel',
      {
        zone: input.zone,
      },
    );
    // `fullName` is required by the server when this success arm fires.
    // On a follow-up call, `input.fullName` is present (discriminated
    // union enforces it). On an initial-call success arm, the BE returned
    // tokens straight away without needing the field — fall back to an
    // empty string here.
    const fullNameForFallback =
      input.kind === 'follow_up' ? input.fullName : '';
    const parts = fullNameForFallback.trim().split(/\s+/);
    user = {
      id: 'pending',
      firstName: parts[0] ?? '',
      lastName: parts.slice(1).join(' '),
      email: input.email,
      zone: input.zone,
    };
  }
  // Mark ToS as accepted for signup flow (the user went through the ToS
  // screen or --signup was used, which implies acceptance)
  const userWithTos: StoredUser = {
    ...user,
    tosAccepted: true,
    tosAcceptedAt: new Date().toISOString(),
  };

  // Last guard before persistence: if the caller aborted at any point —
  // axios responses already returned, fetchUserWithProvisioningRetry's
  // sleep loop completed — skip the disk write so a cancelled ceremony
  // doesn't leak tokens. Mirror the abort guards inside
  // `performDirectSignup` so we cover the window between the last
  // network call and `replaceStoredUser`.
  if (input.signal?.aborted) {
    log.debug('direct signup aborted before persistence; skipping write');
    return { kind: 'error', message: 'aborted' };
  }
  // Persist BEFORE telemetry: a disk/permission failure must propagate to
  // the outer catch so `wrapper_exception` is the sole event — emitting
  // success or user_fetch_failed first would double-count the attempt.
  replaceStoredUser(userWithTos, tokens);
  if (fetchResult.ok) {
    trackSignupAttempt({
      status: 'success',
      zone: input.zone,
      'has env with api key': fetchResult.hasEnvWithApiKey,
      'user fetch retry count': fetchResult.retryCount,
      // Source tag accurately reflects what the attempt's body carried:
      // initial calls have no terms_acceptance ('unused'), follow_up
      // calls have it from whichever URL source the parser recorded
      // (passed in via input.legalDocumentSource). This is what unlocks
      // adoption dashboards once the BE flag flips ON — they can slice
      // success outcomes by URL provenance.
      'legal document source': inputSource,
    });
  } else {
    trackSignupAttempt({
      status: 'user_fetch_failed',
      zone: input.zone,
      'user fetch retry count': fetchResult.retryCount,
      'legal document source': inputSource,
    });
  }

  return {
    kind: 'success',
    idToken: tokens.idToken,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    zone: result.tokens.zone,
    userInfo,
    dashboardUrl: result.dashboardUrl ?? null,
  };
}
