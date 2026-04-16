import type { AmplitudeAuthResult } from './oauth.js';
import { performDirectSignup } from './direct-signup.js';
import { FLAG_DIRECT_SIGNUP, isFlagEnabled } from '../lib/feature-flags.js';
import { storeToken, type StoredUser } from './ampli-settings.js';
import { fetchAmplitudeUser } from '../lib/api.js';
import { createLogger } from '../lib/observability/logger.js';
import type { AmplitudeZone } from '../lib/constants.js';

const log = createLogger('signup-or-auth');

export interface SignupOrAuthInput {
  email: string | null;
  fullName: string | null;
  zone: AmplitudeZone;
}

/**
 * Attempt direct signup via the headless provisioning endpoint.
 *
 * Returns the new account's tokens on success; returns `null` when:
 * - the `wizard-direct-signup` feature flag is off
 * - email or fullName is missing
 * - the endpoint returns `requires_redirect` / `needs_information` / `error`
 * - the direct-signup network call itself errors
 *
 * On success, also fetches the real user profile and persists the
 * `StoredUser` + tokens to `~/.ampli.json` so downstream
 * `resolveCredentials()` can populate `session.credentials` via the
 * standard path. Falls back to the `id:'pending'` sentinel if the
 * user fetch fails.
 *
 * This function does NOT fall back to `performAmplitudeAuth()`. Callers
 * that want OAuth fallback (e.g. the TUI path) must call it explicitly
 * when this returns null. Agent/CI modes typically skip OAuth and let
 * `resolveNonInteractiveCredentials` handle cached-token resolution.
 */
export async function performSignupOrAuth(
  input: SignupOrAuthInput,
): Promise<AmplitudeAuthResult | null> {
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
  try {
    const userInfo = await fetchAmplitudeUser(tokens.idToken, input.zone);
    const user: StoredUser = {
      id: userInfo.id,
      firstName: userInfo.firstName,
      lastName: userInfo.lastName,
      email: userInfo.email,
      zone: input.zone,
    };
    storeToken(user, tokens);
  } catch {
    log.warn(
      'fetchAmplitudeUser failed after direct signup; falling back to pending sentinel',
      {
        zone: input.zone,
      },
    );
    const parts = input.fullName.trim().split(/\s+/);
    const pendingUser: StoredUser = {
      id: 'pending',
      firstName: parts[0] ?? '',
      lastName: parts.slice(1).join(' '),
      email: input.email,
      zone: input.zone,
    };
    storeToken(pendingUser, tokens);
  }

  return {
    idToken: tokens.idToken,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    zone: result.tokens.zone,
  };
}
