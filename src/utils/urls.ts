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
 * and proxies to the Claude model. The Claude Agent SDK uses this as
 * `ANTHROPIC_BASE_URL` and appends `/v1/messages`.
 *
 * Always defaults to the prod gateway — running a local LLM gateway is rare
 * and must be opt-in.
 *
 * Resolution precedence (first match wins):
 *   1. `WIZARD_LLM_PROXY_URL` — full URL override (LiteLLM, local proxy, etc.).
 *   2. `WIZARD_ZONE` — region selector (`us` | `eu`). Used by CI so the
 *      eval / bench harness can hit a specific gateway without threading a
 *      stored zone config through. Invalid values are ignored (fall through).
 *   3. `host` argument — derived from the user's stored config zone.
 *   4. US default.
 */
export const getLlmGatewayUrlFromHost = (host: string) => {
  const proxyOverride = process.env.WIZARD_LLM_PROXY_URL;
  if (proxyOverride) {
    return proxyOverride;
  }

  // CI / harness path: explicit zone override that bypasses host derivation
  // entirely. Lets eval and benchmark workflows hit `core.amplitude.com/wizard`
  // or `core.eu.amplitude.com/wizard` without depending on a stored OAuth
  // session's zone. Trim before truthiness so empty / whitespace-only values
  // fall through to the host-derived default rather than producing a
  // mismatched URL.
  const zoneOverride = process.env.WIZARD_ZONE?.trim().toLowerCase();
  if (zoneOverride === 'eu') {
    return 'https://core.eu.amplitude.com/wizard';
  }
  if (zoneOverride === 'us') {
    return 'https://core.amplitude.com/wizard';
  }

  if (host.includes('eu.amplitude.com')) {
    return 'https://core.eu.amplitude.com/wizard';
  }

  return 'https://core.amplitude.com/wizard';
};

/**
 * Resolve the Amplitude MCP server base host for a given region.
 *
 * Returns the bare origin (no path); callers append `/mcp`, `/sse`, etc.
 * Both endpoints are real and live: `mcp.amplitude.com` and
 * `mcp.eu.amplitude.com` both authenticate and route to the regional
 * data center. Routing an EU user's session through the US MCP host
 * sends their queries through US infrastructure — a compliance issue,
 * not just a UX issue.
 */
export const getMcpHostFromRegion = (region: CloudRegion): string => {
  if (region === 'eu') {
    return 'https://mcp.eu.amplitude.com';
  }
  return 'https://mcp.amplitude.com';
};

/**
 * Build the streamable-HTTP MCP endpoint URL for a region.
 *
 * Resolution order (first match wins):
 *   1. `MCP_URL` env override — primarily for tests / dev pointing at a
 *      staging or local server. Honored regardless of region.
 *   2. `local: true` — `http://localhost:8787/mcp`. Used by `--local-mcp`
 *      and the `mcp add --local` developer flag.
 *   3. Region-aware production: `mcp.amplitude.com/mcp` (US) or
 *      `mcp.eu.amplitude.com/mcp` (EU).
 *
 * Pass the user's resolved zone — never assume US. The returned URL gets
 * baked into editor configs (Claude Code, Cursor, VS Code, etc.) so the
 * value persists past the wizard run; getting this wrong sticks the user
 * with a wrong-region MCP forever.
 */
export const getMcpUrlFromZone = (
  region: CloudRegion,
  options: { local?: boolean; path?: 'mcp' | 'sse' } = {},
): string => {
  const { local = false, path = 'mcp' } = options;
  const envOverride = process.env.MCP_URL?.trim();
  if (envOverride) {
    return envOverride;
  }
  if (local) {
    return `http://localhost:8787/${path}`;
  }
  return `${getMcpHostFromRegion(region)}/${path}`;
};
