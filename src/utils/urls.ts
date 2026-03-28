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
 * Get the Thunder API base URL for a given cloud region.
 * Used for agentic API calls (e.g. /agentic/api/project-credentials).
 */
export const getThunderBaseUrl = (region: CloudRegion): string => {
  const override = process.env.WIZARD_THUNDER_BASE_URL;
  if (override) return override;

  if (IS_DEV) {
    return 'http://localhost:8010';
  }

  if (region === 'eu') {
    return 'https://core.eu.amplitude.com';
  }

  return 'https://core.amplitude.com';
};

/**
 * Get the LLM proxy URL for the Claude Agent SDK.
 *
 * Routes through the wizard-proxy-router in Thunder (javascript repo), which
 * validates Amplitude OAuth tokens and proxies to GCP Vertex AI.
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
    // Local dev: point at the local proxy (start with `pnpm proxy` in the wizard repo)
    return 'http://localhost:3030/wizard';
  }

  if (
    host.includes('eu.amplitude.com') ||
    host.includes('eu.i.amplitude.com')
  ) {
    return 'https://core.eu.amplitude.com/wizard';
  }

  return 'https://core.amplitude.com/wizard';
};
