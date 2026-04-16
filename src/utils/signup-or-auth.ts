import { performAmplitudeAuth, type AmplitudeAuthResult } from './oauth.js';
import { performDirectSignup } from './direct-signup.js';
import { FLAG_DIRECT_SIGNUP, isFlagEnabled } from '../lib/feature-flags.js';
import { storeToken, type StoredUser } from './ampli-settings.js';
import { createLogger } from '../lib/observability/logger.js';
import type { AmplitudeZone } from '../lib/constants.js';

const log = createLogger('signup-or-auth');

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
    // Persist to ~/.ampli.json in the same format as OAuth.
    const parts = input.fullName!.trim().split(/\s+/);
    const pendingUser: StoredUser = {
      id: 'pending',
      firstName: parts[0] ?? '',
      lastName: parts.slice(1).join(' '),
      email: input.email!,
      zone: input.zone,
    };
    storeToken(pendingUser, {
      accessToken: result.tokens.accessToken,
      idToken: result.tokens.idToken,
      refreshToken: result.tokens.refreshToken,
      expiresAt: result.tokens.expiresAt,
    });
    return {
      idToken: result.tokens.idToken,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      zone: result.tokens.zone,
    };
  }

  log.debug('falling back to OAuth', { kind: result.kind });
  return performAmplitudeAuth({
    zone: input.zone,
    forceFresh: input.forceFresh,
  });
}
