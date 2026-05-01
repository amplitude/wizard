/**
 * Shared constants for the Amplitude wizard.
 */

// Kept in sync by release-please (x-release-please-version marker).
// The prebuild script (sync-version.mjs) acts as a safety net.
const VERSION = '1.15.0'; // x-release-please-version

/** Public alias for the wizard version. Same value as the internal `VERSION`
 * but exported for consumers (e.g. the bug-report module). */
export const WIZARD_VERSION = VERSION;

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
  swift = 'swift',
  reactNative = 'react-native',
  android = 'android',
  flutter = 'flutter',
  go = 'go',
  java = 'java',
  unreal = 'unreal',
  unity = 'unity',

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

/** When set, limits the agent to at most 5 events for faster demo runs. */
export const DEMO_MODE = process.env.DEMO_MODE_WIZARD === '1';

/** Amplitude Claude Code plugin identifiers. */
export const CLAUDE_PLUGIN_MARKETPLACE_NAME = 'amplitude';
export const CLAUDE_PLUGIN_MARKETPLACE_REPO = 'amplitude/mcp-marketplace';
export const CLAUDE_PLUGIN_ID = 'amplitude';

/**
 * Shared between yargs `coerce` and `CliArgsSchema` — a mismatch would let
 * yargs accept a value zod rejects, silently nulling `signupEmail` via the
 * `parsed.success` fallback. Format-only; provisioning is authoritative.
 */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── URLs ─────────────────────────────────────────────────────────────

export const DEFAULT_URL = 'https://amplitude.com';
export const TERMS_OF_SERVICE_URL = 'https://amplitude.com/terms';
export const PRIVACY_POLICY_URL = 'https://amplitude.com/privacy';
/**
 * Default Amplitude data ingestion host used when region resolution isn't
 * available (e.g. CI mode without OAuth, --api-key path). Always points at
 * a real prod ingestion endpoint so dev contributors don't leak
 * `localhost:8010` into a user's `.env.local` or setup report. Override
 * via `AMPLITUDE_WIZARD_INGESTION_HOST` for local proxying — empty or
 * whitespace-only values are ignored to keep us in lockstep with
 * `getHostFromRegion()`.
 */
const ingestionHostOverride =
  process.env.AMPLITUDE_WIZARD_INGESTION_HOST?.trim();
export const DEFAULT_HOST_URL =
  ingestionHostOverride || 'https://api2.amplitude.com';

// ── Analytics (internal) ──────────────────────────────────────────────

// OSS builds do not ship internal telemetry credentials. Private release flows
// can inject real values at build time.
export const ANALYTICS_AMPLITUDE_PUBLIC_PROJECT_WRITE_KEY = '';
export const ANALYTICS_HOST_URL = '';
export const ANALYTICS_TEAM_TAG = 'amplitude-wizard';

// ── OAuth / Auth ────────────────────────────────────────────────────

/** Matches the port used by the ampli CLI so sessions are interoperable. */
export const OAUTH_PORT = 13222;

export const AMPLITUDE_ZONE_SETTINGS = {
  us: {
    oAuthHost: process.env.OAUTH_HOST ?? 'https://auth.amplitude.com',
    oAuthClientId:
      process.env.OAUTH_CLIENT_ID ?? '0ac84169-c41c-4222-885b-31469c761cb0',
    dataApiUrl:
      process.env.AMPLITUDE_WIZARD_DATA_API_URL ??
      'https://data-api.amplitude.com/graphql',
    /** App API GraphQL endpoint — org-scoped. Append the numeric orgId. */
    appApiUrlBase: 'https://core.amplitude.com/t/graphql/org/',
    webUrl: 'https://data.amplitude.com',
  },
  eu: {
    oAuthHost: 'https://auth.eu.amplitude.com',
    oAuthClientId:
      process.env.OAUTH_CLIENT_ID ?? '110d04a1-8e60-4157-9c43-fcbe4e014a85',
    // AMPLITUDE_WIZARD_DATA_API_URL is US-only by design — matches the
    // OAUTH_HOST override pattern. EU developers mocking the API locally
    // should run tests against the `us` zone.
    dataApiUrl: 'https://data-api.eu.amplitude.com/graphql',
    /** App API GraphQL endpoint — org-scoped. Append the numeric orgId. */
    appApiUrlBase: 'https://core.eu.amplitude.com/t/graphql/org/',
    webUrl: 'https://data.eu.amplitude.com',
  },
} as const;

export type AmplitudeZone = keyof typeof AMPLITUDE_ZONE_SETTINGS;
export const DEFAULT_AMPLITUDE_ZONE: AmplitudeZone = 'us';

/**
 * Every URL the wizard opens in the browser or presents as a link to the user.
 * Keep this inventory accurate — the Amplitude UI uses it to allowlist outbound
 * navigation from the wizard.
 *
 * Zone-dependent entries are keyed by AmplitudeZone.
 * Builder functions compose the full URL from the base + runtime data (orgId, orgName).
 */
export const OUTBOUND_URLS = {
  // ── Amplitude app base URLs ──────────────────────────────────────────────
  // Deep-links into the chart/dashboard editor use app.eu.amplitude.com for EU.
  // Overview and Slack settings use eu.amplitude.com (no "app." prefix) for EU.

  /** App base — used for chart/dashboard/checklist deep-links. */
  app: {
    us: 'https://app.amplitude.com',
    eu: 'https://app.eu.amplitude.com',
  } as Record<AmplitudeZone, string>,

  /** Overview base — used for Outro, Slack settings, and sign-up continuation. */
  overview: {
    us: 'https://app.amplitude.com',
    eu: 'https://eu.amplitude.com',
  } as Record<AmplitudeZone, string>,

  // ── Auth ─────────────────────────────────────────────────────────────────

  /** OAuth authorization page — opened automatically to start sign-in. */
  oAuth: (zone: AmplitudeZone): string =>
    `${AMPLITUDE_ZONE_SETTINGS[zone].oAuthHost}/oauth2/auth`,

  // ── Checklist deep-links ─────────────────────────────────────────────────

  /** New segmentation chart — opened from the Checklist screen. */
  newChart: (zone: AmplitudeZone, orgId?: string | null): string => {
    const base = OUTBOUND_URLS.app[zone];
    return orgId ? `${base}/${orgId}/chart/new` : `${base}/chart/new`;
  },

  /** New dashboard — opened from the Checklist screen. */
  newDashboard: (zone: AmplitudeZone, orgId?: string | null): string => {
    const base = OUTBOUND_URLS.app[zone];
    return orgId ? `${base}/${orgId}/dashboard/new` : `${base}/dashboard/new`;
  },

  // ── Post-setup ────────────────────────────────────────────────────────────

  /** Slack integration settings — opened from the Slack screen. */
  slackSettings: (zone: AmplitudeZone, orgId?: string | null): string => {
    const base = OUTBOUND_URLS.app[zone];
    if (orgId) {
      return `${base}/analytics/org/${orgId}/settings/profile`;
    }
    return `${base}/analytics/settings/profile`;
  },

  /** Projects settings — opened when the user wants to create a new project. */
  projectsSettings: (zone: AmplitudeZone, orgId?: string | null): string => {
    const base = OUTBOUND_URLS.app[zone];
    if (orgId) {
      return `${base}/analytics/org/${orgId}/settings/projects`;
    }
    return `${base}/analytics/settings/projects`;
  },

  /** Products page — shown in the Outro for sign-up users. */
  products: (zone: AmplitudeZone): string =>
    `${OUTBOUND_URLS.overview[zone]}/products?source=wizard`,

  // ── Docs ─────────────────────────────────────────────────────────────────

  /** SDK overview — opened from the Activation Options screen. */
  sdkDocs: 'https://amplitude.com/docs/sdks',

  /** Amplitude MCP docs — shown after a successful raw MCP install. */
  mcpDocs: 'https://amplitude.com/docs/amplitude-ai/amplitude-mcp',

  /** Claude Code plugin docs (deep-link into the MCP doc) — shown after plugin install. */
  claudePluginDocs:
    'https://amplitude.com/docs/amplitude-ai/amplitude-mcp#plugins',

  /** Per-framework SDK docs — referenced in agent prompts and post-run links. */
  frameworkDocs: {
    browser: 'https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2',
    python: 'https://amplitude.com/docs/sdks/analytics/python',
    java: 'https://amplitude.com/docs/sdks/analytics/java/jre-java-sdk',
    go: 'https://amplitude.com/docs/sdks/analytics/go/go-sdk',
    android:
      'https://amplitude.com/docs/sdks/analytics/android/android-kotlin-sdk',
    reactNative:
      'https://amplitude.com/docs/sdks/analytics/react-native/react-native-sdk',
    ios: 'https://amplitude.com/docs/sdks/analytics/ios/unified-sdk',
    flutter: 'https://amplitude.com/docs/sdks/analytics/flutter/flutter-sdk-4',
    unity: 'https://amplitude.com/docs/sdks/analytics/unity/unity-sdk',
    unreal: 'https://amplitude.com/docs/sdks/analytics/unreal/unreal-sdk',
  },

  // ── Tips ──────────────────────────────────────────────────────────────────

  /** Stripe data-source deep-link — shown as a tip in the RunScreen. */
  stripeDataSource:
    'https://app.amplitude.com/project/data-warehouse/new-source?kind=Stripe',

  // ── Status ────────────────────────────────────────────────────────────────

  /** Service status pages — shown in the OutageOverlay. */
  status: {
    amplitude: 'https://www.amplitudestatus.com',
  },

  // ── Support ───────────────────────────────────────────────────────────────

  /** Bug reports and feedback. */
  githubIssues: 'https://github.com/amplitude/wizard/issues',
};

/** Placeholder embedded in generated code when the user skips key entry. */
export const DUMMY_PROJECT_API_KEY = '_YOUR_AMPLITUDE_API_KEY_';

// ── Wizard run / variants ───────────────────────────────────────────

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
