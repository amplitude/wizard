import axios from 'axios';
import { IS_DEV, WIZARD_USER_AGENT } from '../lib/constants';
import type { CloudRegion } from './types';

export const getHostFromRegion = (region: CloudRegion) => {
  if (IS_DEV) {
    return 'http://localhost:8010';
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
 */
export const getLlmGatewayUrlFromHost = (host: string) => {
  // Allow explicit override for local proxy development
  const proxyOverride = process.env.WIZARD_LLM_PROXY_URL;
  if (proxyOverride) {
    return proxyOverride;
  }

  if (host.includes('localhost')) {
    return 'http://localhost:3030/wizard';
  }

  if (host.includes('eu.amplitude.com')) {
    return 'https://core.eu.amplitude.com/wizard';
  }

  return 'https://core.amplitude.com/wizard';
};
