import axios from 'axios';
import { IS_DEV, WIZARD_USER_AGENT } from '../lib/constants';
import type { CloudRegion } from './types';

/**
 * Resolve the Amplitude data ingestion host for a given region.
 *
 * This is the URL the user's Amplitude SDK targets — it MUST always be a
 * real Amplitude ingestion endpoint (or an explicit override). We never
 * substitute the wizard's local LLM-gateway port here, even in dev:
 * dev contributors who write `.env.local` or a setup report against a
 * test app would otherwise leak `localhost:8010` into shared output.
 *
 * Override with `AMPLITUDE_WIZARD_INGESTION_HOST` for advanced cases
 * (e.g. pointing the wizard at a local Amplitude proxy).
 */
export const getHostFromRegion = (region: CloudRegion) => {
  // Trim before truthiness check so empty / whitespace-only env values fall
  // through to the prod default — matches `DEFAULT_HOST_URL` in constants.ts.
  const override = process.env.AMPLITUDE_WIZARD_INGESTION_HOST?.trim();
  if (override) {
    return override;
  }

  if (region === 'eu') {
    return 'https://api.eu.amplitude.com';
  }

  return 'https://api2.amplitude.com';
};

export const getCloudUrlFromRegion = (region: CloudRegion) => {
  if (region === 'eu') {
    return 'https://eu.amplitude.com';
  }

  return 'https://app.amplitude.com';
};

export async function detectRegionFromToken(
  accessToken: string,
): Promise<CloudRegion> {
  if (IS_DEV) {
    return 'us';
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': WIZARD_USER_AGENT,
  };

  const [usResult, euResult] = await Promise.allSettled([
    axios.get('https://us.amplitude.com/api/users/@me/', { headers }),
    axios.get('https://eu.amplitude.com/api/users/@me/', { headers }),
  ]);

  if (usResult.status === 'fulfilled') return 'us';
  if (euResult.status === 'fulfilled') return 'eu';

  throw new Error(
    'Could not determine cloud region from access token. Please check your Amplitude account.',
  );
}

/**
 * Get the LLM proxy URL for the Claude Agent SDK.
 *
 * Routes through Amplitude's LLM gateway, which validates OAuth tokens
 * and proxies to the Claude model.
 *
 * Override with WIZARD_LLM_PROXY_URL env var for explicit URL override.
 * The Claude Agent SDK uses this as ANTHROPIC_BASE_URL and appends /v1/messages.
 *
 * In dev mode (`NODE_ENV=development|test`) the wizard talks to a locally
 * running gateway. Previously we inferred dev mode from the host string
 * containing `localhost`; now that `getHostFromRegion()` always returns a
 * prod URL, we read `NODE_ENV` directly. We read it per-call (not via the
 * cached `IS_DEV` constant) so tests can toggle without re-importing.
 */
export const getLlmGatewayUrlFromHost = (host: string) => {
  // Allow explicit override for local proxy development
  const proxyOverride = process.env.WIZARD_LLM_PROXY_URL;
  if (proxyOverride) {
    return proxyOverride;
  }

  const nodeEnv = process.env.NODE_ENV ?? '';
  if (nodeEnv === 'development' || nodeEnv === 'test') {
    return 'http://localhost:3030/wizard';
  }

  if (host.includes('eu.amplitude.com')) {
    return 'https://core.eu.amplitude.com/wizard';
  }

  return 'https://core.amplitude.com/wizard';
};
