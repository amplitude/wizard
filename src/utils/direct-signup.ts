import axios, { AxiosError } from 'axios';
import { z } from 'zod';
import {
  AMPLITUDE_ZONE_SETTINGS,
  type AmplitudeZone,
} from '../lib/constants.js';
import { createLogger } from '../lib/observability/logger.js';

const log = createLogger('direct-signup');

const SuccessSchema = z.object({
  access_token: z.string(),
  id_token: z.string(),
  refresh_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
});

const RequiresRedirectSchema = z.object({
  requires_redirect: z.literal(true),
});

export interface DirectSignupInput {
  email: string;
  fullName: string;
  zone: AmplitudeZone;
}

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
    }
  | { kind: 'requires_redirect' }
  | { kind: 'error'; message: string };

/**
 * Attempts to create an Amplitude account and obtain tokens directly via the
 * signup endpoint (amplitude/javascript PR #103683). Callers should fall back
 * to the OAuth redirect flow on `requires_redirect` or `error`.
 */
export async function performDirectSignup(
  input: DirectSignupInput,
): Promise<DirectSignupResult> {
  const { oAuthHost } = AMPLITUDE_ZONE_SETTINGS[input.zone];
  const url = `${oAuthHost}/signup`;
  log.debug('[direct-signup] POST', { url, zone: input.zone });

  try {
    const response = await axios.post(
      url,
      { email: input.email, fullName: input.fullName, zone: input.zone },
      {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: (s) => s < 500,
      },
    );

    const redirect = RequiresRedirectSchema.safeParse(response.data);
    if (redirect.success) return { kind: 'requires_redirect' };
    if (response.status === 409) return { kind: 'requires_redirect' };

    const success = SuccessSchema.safeParse(response.data);
    if (success.success) {
      const expiresAt = new Date(
        Date.now() + success.data.expires_in * 1000,
      ).toISOString();
      return {
        kind: 'success',
        tokens: {
          accessToken: success.data.access_token,
          idToken: success.data.id_token,
          refreshToken: success.data.refresh_token,
          expiresAt,
          zone: input.zone,
        },
      };
    }

    log.error('[direct-signup] unexpected response shape', {
      status: response.status,
    });
    return {
      kind: 'error',
      message: `Unexpected response (${response.status})`,
    };
  } catch (e) {
    const err =
      e instanceof AxiosError
        ? e.message
        : e instanceof Error
        ? e.message
        : String(e);
    log.error('[direct-signup] network error', { err });
    return { kind: 'error', message: err };
  }
}
