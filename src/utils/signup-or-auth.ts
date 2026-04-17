import { performAmplitudeAuth, type AmplitudeAuthResult } from './oauth.js';
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
  signup: boolean;
  email: string | null;
  fullName: string | null;
  zone: AmplitudeZone;
  forceFresh?: boolean;
}

/**
 * Chooses between direct signup (when gated flag on, --signup set, and
 * email + fullName provided) and the existing OAuth flow. Falls back to
 * OAuth when direct signup returns requires_redirect or error.
 */
export async function performSignupOrAuth(
  input: SignupOrAuthInput,
): Promise<AmplitudeAuthResult> {
  const shouldAttemptDirect =
    input.signup &&
    isFlagEnabled(FLAG_DIRECT_SIGNUP) &&
    input.email !== null &&
    input.fullName !== null;

  if (!shouldAttemptDirect) {
    log.debug('skipping direct signup, using OAuth');
    return performAmplitudeAuth({
      zone: input.zone,
      forceFresh: input.forceFresh,
    });
  }

  log.debug('attempting direct signup');
  const result = await performDirectSignup({
    email: input.email!,
    fullName: input.fullName!,
    zone: input.zone,
  });

  if (result.kind === 'success') {
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
    try {
      const userInfo = await fetchUserWithProvisioningRetry(
        tokens.idToken,
        input.zone,
      );
      const user: StoredUser = {
        id: userInfo.id,
        firstName: userInfo.firstName,
        lastName: userInfo.lastName,
        email: userInfo.email,
        zone: input.zone,
      };
      storeToken(user, tokens);
    } catch (_err) {
      log.warn(
        'fetchAmplitudeUser failed after direct signup; falling back to pending sentinel',
        {
          zone: input.zone,
        },
      );
      const parts = input.fullName!.trim().split(/\s+/);
      const pendingUser: StoredUser = {
        id: 'pending',
        firstName: parts[0] ?? '',
        lastName: parts.slice(1).join(' '),
        email: input.email!,
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

  log.debug('falling back to OAuth', { kind: result.kind });
  return performAmplitudeAuth({
    zone: input.zone,
    forceFresh: input.forceFresh,
  });
}
