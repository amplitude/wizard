import type { SignupOutcome } from './oauth.js';
import { performDirectSignup } from './direct-signup.js';
import { FLAG_DIRECT_SIGNUP, isFlagEnabled } from '../lib/feature-flags.js';
import {
  storeToken,
  type StoredOAuthToken,
  type StoredUser,
} from './ampli-settings.js';
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
    return {
      ok: true,
      userInfo,
      retryCount,
      hasEnvWithApiKey: hasEnvWithApiKey(userInfo),
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
 * Attempt direct signup via the headless provisioning endpoint.
 *
 * Always returns a {@link SignupOutcome}, so persistence is guaranteed and
 * the caller never has to remember to call `storeToken`. The outcome is:
 *
 * - `complete` — signup succeeded, userInfo fetched, record persisted.
 * - `pending-recovery` — signup succeeded but userInfo fetch failed after
 *   retries. Tokens are persisted under a `{id:'pending'}` sentinel so the
 *   next run recovers via cached-session lookup without forcing the user
 *   back through a browser redirect (the whole point of `--signup`).
 * - `skipped` — feature flag off, email/fullName missing, or the signup
 *   endpoint returned `requires_redirect` / `error`. Callers can choose
 *   to fall back to `performAmplitudeAuth` or abort.
 */
export async function performSignupOrAuth(
  input: SignupOrAuthInput,
): Promise<SignupOutcome> {
  if (!isFlagEnabled(FLAG_DIRECT_SIGNUP)) {
    log.debug('flag off; skipping direct signup');
    return { status: 'skipped' };
  }
  if (input.email === null || input.fullName === null) {
    log.debug('missing email or fullName; skipping direct signup');
    return { status: 'skipped' };
  }

  log.debug('attempting direct signup');
  // performDirectSignup is contracted to catch its own network/parse errors
  // and return { kind: 'error' }. The try/catch here is belt-and-suspenders
  // enforcement of the wrapper's documented skipped-on-any-error behavior.
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
    return { status: 'skipped' };
  }

  if (result.kind === 'requires_redirect') {
    log.debug('direct signup did not succeed', { kind: result.kind });
    trackSignupAttempt({ status: 'requires_redirect', zone: input.zone });
    return { status: 'skipped' };
  }
  if (result.kind === 'error') {
    log.debug('direct signup did not succeed', { kind: result.kind });
    trackSignupAttempt({ status: 'signup_error', zone: input.zone });
    return { status: 'skipped' };
  }

  const tokens: StoredOAuthToken = {
    accessToken: result.tokens.accessToken,
    idToken: result.tokens.idToken,
    refreshToken: result.tokens.refreshToken,
    expiresAt: result.tokens.expiresAt,
  };

  // Fetch the real user profile. Retries briefly on the "no env with API key
  // yet" case to absorb post-signup provisioning lag.
  const fetchResult = await fetchUserWithProvisioningRetry(
    tokens.idToken,
    input.zone,
  );

  if (fetchResult.ok) {
    const userInfo = fetchResult.userInfo;
    const user: StoredUser = {
      id: userInfo.id,
      firstName: userInfo.firstName,
      lastName: userInfo.lastName,
      email: userInfo.email,
      zone: input.zone,
    };
    storeToken(user, tokens);
    trackSignupAttempt({
      status: 'success',
      zone: input.zone,
      'has env with api key': fetchResult.hasEnvWithApiKey,
      'user fetch retry count': fetchResult.retryCount,
    });
    return {
      status: 'complete',
      user,
      userInfo,
      tokens,
      zone: result.tokens.zone,
    };
  }

  // Failure: preserve tokens for next-run recovery under a pending sentinel.
  // Without this, `--signup` users who hit a userInfo race would be pushed
  // back to a browser redirect (TUI) or dead-end (CI, where re-signup fails
  // because the account already exists) — defeating the whole point of --signup.
  log.warn('fetchAmplitudeUser failed after direct signup', {
    zone: input.zone,
  });
  const parts = input.fullName.trim().split(/\s+/);
  const pendingUser: StoredUser = {
    id: 'pending',
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
    email: input.email,
    zone: input.zone,
  };
  storeToken(pendingUser, tokens);
  trackSignupAttempt({
    status: 'user_fetch_failed',
    zone: input.zone,
    'user fetch retry count': fetchResult.retryCount,
  });
  return {
    status: 'pending-recovery',
    tokens,
    zone: result.tokens.zone,
  };
}
