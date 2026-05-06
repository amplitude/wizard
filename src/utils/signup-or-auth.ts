import type { AmplitudeAuthResult } from './oauth.js';
import { performDirectSignup } from './direct-signup.js';
import { replaceStoredUser, type StoredUser } from './ampli-settings.js';
import { fetchAmplitudeUser, type AmplitudeUserInfo } from '../lib/api.js';
import { createLogger } from '../lib/observability/logger.js';
import type { AmplitudeZone } from '../lib/constants.js';
import { analytics } from './analytics.js';

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
};

export const trackSignupAttempt = (
  properties: AgenticSignupAttemptedProperties,
): void => {
  analytics.wizardCapture(AGENTIC_SIGNUP_ATTEMPTED_EVENT, properties);
};

export interface SignupOrAuthInput {
  email: string | null;
  /**
   * Optional. Omit on the probe POST so the server can decide whether the
   * account is new (→ `needs_information`) or already exists (→ redirect).
   * Pass it on the follow-up POST after the wizard collected it.
   */
  fullName?: string | null;
  zone: AmplitudeZone;
}

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
  | { kind: 'needs_information'; requiredFields: string[] }
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
  const fullName = input.fullName ?? null;

  log.debug('attempting direct signup', { hasFullName: fullName !== null });
  // performDirectSignup is contracted to catch its own network/parse errors
  // and return { kind: 'error' }. The try/catch here is belt-and-suspenders
  // enforcement against an unexpected throw — emit `wrapper_exception`
  // telemetry so a thrown error is distinguishable from a clean error arm.
  let result: Awaited<ReturnType<typeof performDirectSignup>>;
  try {
    result = await performDirectSignup({
      email: input.email,
      ...(fullName !== null ? { fullName } : {}),
      zone: input.zone,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('direct signup threw unexpectedly', { message });
    trackSignupAttempt({ status: 'wrapper_exception', zone: input.zone });
    return { kind: 'error', message };
  }

  if (result.kind === 'requires_redirect') {
    log.debug('direct signup → redirect');
    trackSignupAttempt({ status: 'requires_redirect', zone: input.zone });
    return { kind: 'redirect' };
  }
  if (result.kind === 'needs_information') {
    log.debug('direct signup → needs_information', {
      requiredFields: result.requiredFields,
    });
    trackSignupAttempt({ status: 'needs_information', zone: input.zone });
    return {
      kind: 'needs_information',
      requiredFields: result.requiredFields,
    };
  }
  if (result.kind === 'error') {
    log.debug('direct signup → error', {
      message: result.message,
      code: result.code,
    });
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
    trackSignupAttempt({ status, zone: input.zone });
    return { kind: 'error', message: result.message };
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
    // `fullName` is required by the server when this success arm fires, so
    // it's non-null here despite being optional in the input — the server
    // would have returned `needs_information` otherwise.
    const parts = (fullName ?? '').trim().split(/\s+/);
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
    });
  } else {
    trackSignupAttempt({
      status: 'user_fetch_failed',
      zone: input.zone,
      'user fetch retry count': fetchResult.retryCount,
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
