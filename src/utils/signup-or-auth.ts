import type { AmplitudeAuthResult } from './oauth.js';
import { performDirectSignup } from './direct-signup.js';
import { replaceStoredUser, type StoredUser } from './ampli-settings.js';
import { clearStaleProjectState } from './clear-stale-project-state.js';
import { fetchAmplitudeUser, type AmplitudeUserInfo } from '../lib/api.js';
import { createLogger } from '../lib/observability/logger.js';
import type { AmplitudeZone } from '../lib/constants.js';
import { analytics } from './analytics.js';

const log = createLogger('signup-or-auth');

// Retry delays for post-signup provisioning: worst-case total wait ~3.5s.
const PROVISIONING_RETRY_DELAYS_MS = [500, 1000, 2000];

function hasEnvWithApiKey(userInfo: AmplitudeUserInfo): boolean {
  return userInfo.orgs.some((org) =>
    org.workspaces.some((ws) =>
      (ws.environments ?? []).some((e) => e.app?.apiKey),
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
  fullName: string | null;
  zone: AmplitudeZone;
  /**
   * Project directory the wizard is running against. Used on successful
   * signup to wipe pre-existing per-project state (keychain API key,
   * .env.local, project ampli.json bindings, session checkpoint) so the
   * new account doesn't inherit the prior account's data — see
   * {@link clearStaleProjectState}.
   */
  installDir: string;
}

export interface SignupOrAuthOptions {
  /**
   * Cancel the in-flight signup POST. Forwarded to `performDirectSignup`
   * which passes it to axios. Used by SigningUpScreen to abort the
   * request on unmount.
   */
  signal?: AbortSignal;
}

/**
 * Result of {@link performSignupOrAuth}. Discriminated union that surfaces
 * each non-success outcome as its own arm so callers can branch without
 * relying on a null-means-what sentinel.
 *
 * Success arm extends {@link AmplitudeAuthResult} with the user profile
 * fetched inside the function, so callers can skip a redundant
 * `fetchAmplitudeUser` call.
 *
 * `userInfo` is:
 * - populated on the direct-signup success path when the internal fetch
 *   (with provisioning retry) succeeded
 * - `null` on the pending-sentinel path (internal fetch failed) — the
 *   caller is responsible for fetching userInfo itself in that case
 */
export type PerformSignupOrAuthResult =
  | ({ kind: 'success' } & AmplitudeAuthResult & {
        userInfo: AmplitudeUserInfo | null;
      })
  | { kind: 'requires_redirect' }
  | { kind: 'needs_information'; requiredFields: string[] }
  | { kind: 'error' };

// Narrowed type used by WizardSession.signupAuth — only the success arm is
// ever written to the session.
export type SignupSuccessResult = Extract<
  PerformSignupOrAuthResult,
  { kind: 'success' }
>;

/**
 * Attempt direct signup via the headless provisioning endpoint.
 *
 * Returns a discriminated union:
 * - `{ kind: 'success', ... }` — new account provisioned; tokens (and
 *   userInfo when the internal fetch succeeded) are populated
 * - `{ kind: 'requires_redirect' }` — endpoint bounced us to browser OAuth
 * - `{ kind: 'needs_information', requiredFields }` — endpoint needs more
 *   information (e.g. full_name) before it can provision
 * - `{ kind: 'error' }` — email missing, endpoint returned error, or the
 *   network call itself threw
 *
 * On success, also fetches the real user profile and persists the
 * `StoredUser` + tokens to `~/.ampli.json` so downstream
 * `resolveCredentials()` can populate `session.credentials` via the
 * standard path. Falls back to the `id:'pending'` sentinel if the
 * user fetch fails. The user fetch retries briefly on the "no env with
 * API key yet" case to absorb post-signup provisioning lag.
 *
 * This function does NOT fall back to `performAmplitudeAuth()`. Callers
 * that want OAuth fallback (e.g. the TUI path) must call it explicitly
 * for the non-success arms. Agent/CI modes typically skip OAuth and let
 * `resolveNonInteractiveCredentials` handle cached-token resolution.
 */
export async function performSignupOrAuth(
  input: SignupOrAuthInput,
  options: SignupOrAuthOptions = {},
): Promise<PerformSignupOrAuthResult> {
  if (input.email === null) {
    log.debug('missing email; skipping direct signup');
    return { kind: 'error' };
  }

  log.debug('attempting direct signup');
  // performDirectSignup is contracted to catch its own network/parse errors
  // and return { kind: 'error' }. The try/catch here is belt-and-suspenders
  // enforcement of the wrapper's documented error-arm-on-any-error behavior —
  // callers rely on the error arm to decide fallback strategy.
  let result: Awaited<ReturnType<typeof performDirectSignup>>;
  try {
    result = await performDirectSignup(
      {
        email: input.email,
        fullName: input.fullName,
        zone: input.zone,
      },
      { signal: options.signal },
    );
  } catch (err) {
    log.warn('direct signup threw unexpectedly', {
      message: err instanceof Error ? err.message : String(err),
    });
    trackSignupAttempt({ status: 'signup_error', zone: input.zone });
    return { kind: 'error' };
  }

  if (result.kind === 'requires_redirect') {
    log.debug('direct signup did not succeed', { kind: result.kind });
    trackSignupAttempt({ status: 'requires_redirect', zone: input.zone });
    return { kind: 'requires_redirect' };
  }
  if (result.kind === 'needs_information') {
    log.debug('direct signup requires additional information', {
      requiredFields: result.requiredFields,
    });
    trackSignupAttempt({ status: 'needs_information', zone: input.zone });
    return {
      kind: 'needs_information',
      requiredFields: result.requiredFields,
    };
  }
  if (result.kind === 'error') {
    log.debug('direct signup did not succeed', { kind: result.kind });
    trackSignupAttempt({ status: 'signup_error', zone: input.zone });
    return { kind: 'error' };
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
    const parts = input.fullName ? input.fullName.trim().split(/\s+/) : [];
    user = {
      id: 'pending',
      firstName: parts[0] ?? '',
      lastName: parts.slice(1).join(' '),
      email: input.email,
      zone: input.zone,
    };
  }
  // Wipe pre-existing per-project state BEFORE persisting the new account.
  // Mirrors `replaceStoredUser`'s wipe-then-write pattern across the
  // install-dir-keyed surfaces (keychain, .env.local, project ampli.json,
  // session checkpoint) that `replaceStoredUser` does not touch. Without
  // this, downstream `getAPIKey` short-circuits on the prior account's
  // cached key and silently routes the new account's events into the wrong
  // tenancy. See MCP-196.
  clearStaleProjectState(input.installDir);
  // Persist BEFORE telemetry: a disk/permission failure must propagate to
  // the outer catch so `wrapper_exception` is the sole event — emitting
  // success or user_fetch_failed first would double-count the attempt.
  replaceStoredUser(user, tokens);
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
  };
}
