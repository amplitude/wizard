import type { AmplitudeAuthResult } from './oauth.js';
import { performDirectSignup } from './direct-signup.js';
import { FLAG_DIRECT_SIGNUP, isFlagEnabled } from '../lib/feature-flags.js';
import { storeToken, type StoredUser } from './ampli-settings.js';
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
  | 'signup_error'
  | 'user_fetch_failed'
  | 'wrapper_exception';

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
}

/**
 * Result of {@link performSignupOrAuth}. Extends {@link AmplitudeAuthResult}
 * with the user profile fetched inside the function, so callers can skip a
 * redundant `fetchAmplitudeUser` call.
 *
 * `userInfo` is:
 * - populated on the direct-signup success path when the internal fetch
 *   (with provisioning retry) succeeded
 * - `null` on the pending-sentinel path (internal fetch failed) — the
 *   caller is responsible for fetching userInfo itself in that case
 */
export type PerformSignupOrAuthResult = AmplitudeAuthResult & {
  userInfo: AmplitudeUserInfo | null;
};

/**
 * Attempt direct signup via the headless provisioning endpoint.
 *
 * Returns the new account's tokens (and userInfo, when the internal fetch
 * succeeded) on success; returns `null` when:
 * - the `wizard-direct-signup` feature flag is off
 * - email or fullName is missing
 * - the endpoint returns `requires_redirect` / `needs_information` / `error`
 * - the direct-signup network call itself errors
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
 * when this returns null. Agent/CI modes typically skip OAuth and let
 * `resolveNonInteractiveCredentials` handle cached-token resolution.
 */
export async function performSignupOrAuth(
  input: SignupOrAuthInput,
): Promise<PerformSignupOrAuthResult | null> {
  if (!isFlagEnabled(FLAG_DIRECT_SIGNUP)) {
    log.debug('flag off; skipping direct signup');
    return null;
  }
  if (input.email === null || input.fullName === null) {
    log.debug('missing email or fullName; skipping direct signup');
    return null;
  }

  log.debug('attempting direct signup');
  // performDirectSignup is contracted to catch its own network/parse errors
  // and return { kind: 'error' }. The try/catch here is belt-and-suspenders
  // enforcement of the wrapper's documented null-on-any-error behavior —
  // callers rely on the null return to decide fallback strategy.
  let result: Awaited<ReturnType<typeof performDirectSignup>>;
  try {
    result = await performDirectSignup({
      email: input.email,
      fullName: input.fullName,
      zone: input.zone,
    });
  } catch (err) {
    log.warn('direct signup threw unexpectedly', {
      message: err instanceof Error ? err.message : String(err),
    });
    trackSignupAttempt({ status: 'signup_error', zone: input.zone });
    return null;
  }

  if (result.kind === 'requires_redirect') {
    log.debug('direct signup did not succeed', { kind: result.kind });
    trackSignupAttempt({ status: 'requires_redirect', zone: input.zone });
    return null;
  }
  if (result.kind === 'error') {
    log.debug('direct signup did not succeed', { kind: result.kind });
    trackSignupAttempt({ status: 'signup_error', zone: input.zone });
    return null;
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
    trackSignupAttempt({
      status: 'success',
      zone: input.zone,
      'has env with api key': fetchResult.hasEnvWithApiKey,
      'user fetch retry count': fetchResult.retryCount,
    });
  } else {
    log.warn(
      'fetchAmplitudeUser failed after direct signup; falling back to pending sentinel',
      {
        zone: input.zone,
      },
    );
    const parts = input.fullName.trim().split(/\s+/);
    user = {
      id: 'pending',
      firstName: parts[0] ?? '',
      lastName: parts.slice(1).join(' '),
      email: input.email,
      zone: input.zone,
    };
    trackSignupAttempt({
      status: 'user_fetch_failed',
      zone: input.zone,
      'user fetch retry count': fetchResult.retryCount,
    });
  }
  storeToken(user, tokens);

  return {
    idToken: tokens.idToken,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    zone: result.tokens.zone,
    userInfo,
  };
}
