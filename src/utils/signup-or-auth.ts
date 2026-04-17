import type { AmplitudeAuthResult } from './oauth.js';
import { performDirectSignup } from './direct-signup.js';
import { FLAG_DIRECT_SIGNUP, isFlagEnabled } from '../lib/feature-flags.js';
import { storeToken, type StoredUser } from './ampli-settings.js';
import { fetchAmplitudeUser, type AmplitudeUserInfo } from '../lib/api.js';
import { createLogger } from '../lib/observability/logger.js';
import type { AmplitudeZone } from '../lib/constants.js';

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

/**
 * After a successful direct signup, the backend may not have finished
 * provisioning the default org/workspace/environment. Retry the user
 * fetch a few times so downstream credential resolution finds an env
 * with a project API key, instead of mis-reporting "no_stored_credentials".
 *
 * Retries on both "returned but no env with apiKey" and "threw" — the
 * Data API throws "No user data returned" when orgs is empty, which is
 * the most-likely brand-new-signup race condition. After exhausting
 * retries, the final attempt's result (or error) propagates to the
 * caller's pending-sentinel fallback.
 */
async function fetchUserWithProvisioningRetry(
  idToken: string,
  zone: AmplitudeZone,
): Promise<AmplitudeUserInfo> {
  let userInfo: AmplitudeUserInfo | null = null;
  let lastError: unknown = null;
  try {
    userInfo = await fetchAmplitudeUser(idToken, zone);
  } catch (err) {
    lastError = err;
  }
  for (const delayMs of PROVISIONING_RETRY_DELAYS_MS) {
    if (userInfo && hasEnvWithApiKey(userInfo)) return userInfo;
    log.debug('signup provisioning incomplete; retrying user fetch', {
      delayMs,
      threw: lastError !== null,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    try {
      userInfo = await fetchAmplitudeUser(idToken, zone);
      lastError = null;
    } catch (err) {
      lastError = err;
      userInfo = null;
    }
  }
  if (userInfo) return userInfo;
  throw lastError;
}

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
  const result = await performDirectSignup({
    email: input.email,
    fullName: input.fullName,
    zone: input.zone,
  });

  if (result.kind !== 'success') {
    log.debug('direct signup did not succeed', { kind: result.kind });
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
  try {
    userInfo = await fetchUserWithProvisioningRetry(tokens.idToken, input.zone);
    user = {
      id: userInfo.id,
      firstName: userInfo.firstName,
      lastName: userInfo.lastName,
      email: userInfo.email,
      zone: input.zone,
    };
  } catch {
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
