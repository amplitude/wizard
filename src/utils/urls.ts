import axios from 'axios';
import { IS_DEV, WIZARD_USER_AGENT } from '../lib/constants';
import type { CloudRegion } from './types';

export const getAssetHostFromHost = (host: string) => {
  if (host.includes('us.i.amplitude.com')) {
    return 'https://us-assets.i.amplitude.com';
  }

  if (host.includes('eu.i.amplitude.com')) {
    return 'https://eu-assets.i.amplitude.com';
  }

  return host;
};

export const getUiHostFromHost = (host: string) => {
  if (host.includes('us.i.amplitude.com')) {
    return 'https://us.amplitude.com';
  }

  if (host.includes('eu.i.amplitude.com')) {
    return 'https://eu.amplitude.com';
  }

  return host;
};

export const getHostFromRegion = (region: CloudRegion) => {
  if (IS_DEV) {
    return 'http://localhost:8010';
  }

  if (region === 'eu') {
    return 'https://eu.i.amplitude.com';
  }

  return 'https://us.i.amplitude.com';
};

export const getCloudUrlFromRegion = (region: CloudRegion) => {
  if (IS_DEV) {
    return 'http://localhost:8010';
  }

  if (region === 'eu') {
    return 'https://eu.amplitude.com';
  }

  return 'https://us.amplitude.com';
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
 * Get the LLM gateway URL for the Claude Agent SDK.
 *
 * Override with WIZARD_LLM_PROXY_URL env var for local dev against the
 * Langley wizard proxy (default: http://localhost:9810).
 *
 * The Claude Agent SDK sets this as ANTHROPIC_BASE_URL and appends /v1/messages.
 */
export const getLlmGatewayUrlFromHost = (host: string) => {
  // Allow explicit override for local proxy development
  const proxyOverride = process.env.WIZARD_LLM_PROXY_URL;
  if (proxyOverride) {
    return proxyOverride;
  }

  if (host.includes('localhost')) {
    // Local dev: point at the Langley wizard proxy service
    // Start it with: cd langley && LOCAL_LANGLEY=true ENVIRONMENT=production aws-vault exec us-prod-engineer -- make wizard-proxy-server
    return 'http://localhost:9810';
  }

  if (
    host.includes('eu.amplitude.com') ||
    host.includes('eu.i.amplitude.com')
  ) {
    return 'https://gateway.eu.amplitude.com/wizard';
  }

  return 'https://gateway.us.amplitude.com/wizard';
};
