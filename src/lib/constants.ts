/**
 * Shared constants for the Amplitude wizard.
 */

import { VERSION } from './version';

// ── Integration / CLI ───────────────────────────────────────────────

/**
 * Detection order matters: put framework-specific integrations BEFORE basic language fallbacks.
 */
export enum Integration {
  // Frameworks
  nextjs = 'nextjs',
  vue = 'vue',
  reactRouter = 'react-router',
  django = 'django',
  flask = 'flask',
  fastapi = 'fastapi',

  // Language fallbacks
  javascript_web = 'javascript_web',
  python = 'python',
  javascriptNode = 'javascript_node',

  // Unknown / fallback (framework not detected)
  generic = 'generic',
}

export interface Args {
  debug: boolean;
  integration: Integration;
}

// ── Environment ──────────────────────────────────────────────────────

export const IS_DEV = ['test', 'development'].includes(
  process.env.NODE_ENV ?? '',
);
export const DEBUG = false;

// ── URLs ─────────────────────────────────────────────────────────────

export const DEFAULT_URL = IS_DEV
  ? 'http://localhost:8010'
  : 'https://amplitude.com';
export const DEFAULT_HOST_URL = IS_DEV
  ? 'http://localhost:8010'
  : 'https://api2.amplitude.com';
export const ISSUES_URL = 'https://github.com/amplitude/wizard/issues';

// ── Analytics (internal) ──────────────────────────────────────────────

// TODO: Replace with Amplitude analytics keys
export const ANALYTICS_AMPLITUDE_PUBLIC_PROJECT_WRITE_KEY = '';
export const ANALYTICS_HOST_URL = '';
export const ANALYTICS_TEAM_TAG = 'amplitude-wizard';

// ── OAuth / Auth ────────────────────────────────────────────────────

/** Matches the port used by the ampli CLI so sessions are interoperable. */
export const OAUTH_PORT = 13222;
export const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID ?? 'cli-client-pkce';

export const AMPLITUDE_ZONE_SETTINGS = {
  us: {
    oAuthHost: process.env.OAUTH_HOST ?? 'https://auth.amplitude.com',
    dataApiUrl: 'https://data-api.amplitude.com/graphql',
    webUrl: 'https://data.amplitude.com',
  },
  eu: {
    oAuthHost: 'https://auth.eu.amplitude.com',
    dataApiUrl: 'https://data-api.eu.amplitude.com/graphql',
    webUrl: 'https://data.eu.amplitude.com',
  },
} as const;

export type AmplitudeZone = keyof typeof AMPLITUDE_ZONE_SETTINGS;
export const DEFAULT_AMPLITUDE_ZONE: AmplitudeZone = 'us';

/** Placeholder embedded in generated code when the user skips key entry. */
export const DUMMY_PROJECT_API_KEY = '_YOUR_AMPLITUDE_API_KEY_';

// ── Wizard run / variants ───────────────────────────────────────────

export const WIZARD_REMARK_EVENT_NAME = 'wizard remark';
/** Feature flag key whose value selects a variant from WIZARD_VARIANTS. */
export const WIZARD_VARIANT_FLAG_KEY = 'wizard-variant';
/** Variant key -> metadata for wizard run (VARIANT flag selects which entry to use). */
export const WIZARD_VARIANTS: Record<string, Record<string, string>> = {
  base: { VARIANT: 'base' },
  subagents: { VARIANT: 'subagents' },
};
/** User-Agent for wizard HTTP requests and MCP server identification. */
export const WIZARD_USER_AGENT = `amplitude/wizard; version: ${VERSION}`;

// ── HTTP headers ─────────────────────────────────────────────────────

/** Header prefix for Amplitude properties. */
export const AMPLITUDE_PROPERTY_HEADER_PREFIX = 'X-AMPLITUDE-PROPERTY-';
/** Header prefix for Amplitude feature flags. */
export const AMPLITUDE_FLAG_HEADER_PREFIX = 'X-AMPLITUDE-FLAG-';

// ── Timeouts ─────────────────────────────────────────────────────────

/** Timeout for framework / project detection probes (ms). */
export const DETECTION_TIMEOUT_MS = 10_000;
