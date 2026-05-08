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

/** Single global LLM proxy URL — shared by every region and every user. */
export const WIZARD_LLM_PROXY_URL_DEFAULT =
  'https://wizard.amplitude.com/web-api/wizard';

/**
 * Get the LLM proxy URL for the Claude Agent SDK.
 *
 * Routes through Amplitude's wizard LLM gateway (Next.js + Vertex), which
 * accepts the wizard's existing OAuth bearer in `Authorization: Bearer ...`
 * (or `x-api-key`) and proxies to Claude on Vertex on the user's behalf.
 * The Claude Agent SDK uses this as `ANTHROPIC_BASE_URL` and appends
 * `/v1/messages`; the AI SDK appends `/messages` (we add `/v1` in
 * `ensureV1Suffix`). Both resolve to `…/web-api/wizard/v1/messages` against
 * the proxy's Next.js `basePath`.
 *
 * Returns the same URL for every region — the proxy itself is region-agnostic
 * (the underlying Vertex region is selected server-side). Earlier wizard
 * releases routed via `core.amplitude.com/wizard` and `core.eu.amplitude.com/wizard`;
 * those endpoints are no longer the LLM transport target. The Amplitude
 * data API surface (`/v1/projects`, `/v1/planned-events`) still uses
 * `core.amplitude.com/wizard` — see `getWizardProxyBase` in `lib/api.ts`.
 *
 * The `host` argument is now ignored for the default path. It is preserved
 * so existing callers (which compute it from the user's region) continue to
 * compile without change.
 *
 * Resolution precedence (first match wins):
 *   1. `WIZARD_LLM_PROXY_URL` — full URL override (LiteLLM, local proxy,
 *      staging, dev). Required for any non-prod target.
 *   2. Default: `https://wizard.amplitude.com/web-api/wizard`.
 *
 * `WIZARD_ZONE` is intentionally NOT consulted here anymore — the LLM proxy
 * is global. Eval / bench harnesses that need a specific backend must use
 * `WIZARD_LLM_PROXY_URL` (the existing dev / staging escape hatch).
 */
export const getLlmGatewayUrlFromHost = (_host: string) => {
  const proxyOverride = process.env.WIZARD_LLM_PROXY_URL?.trim();
  if (proxyOverride) {
    return proxyOverride;
  }
  return WIZARD_LLM_PROXY_URL_DEFAULT;
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
