/**
 * WizardSession — single source of truth for every decision the wizard needs.
 *
 * Populated in layers:
 *   CLI args / env vars  →  populate fields directly
 *   Auto-detection       →  framework, typescript, package manager
 *   TUI screens          →  region, framework disambiguation, etc.
 *   OAuth                →  credentials
 *
 * Business logic reads from the session. Never calls a prompt.
 */

import type { Integration } from './constants';
import type { FrameworkConfig } from './framework-config';

function parseProjectIdArg(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export type CloudRegion = 'us' | 'eu';

/** Lifecycle phase of the main work (agent run, MCP install, etc.) */
export const RunPhase = {
  /** Still gathering input (intro, setup screens) */
  Idle: 'idle',
  /** Main work is in progress */
  Running: 'running',
  /** Main work finished successfully */
  Completed: 'completed',
  /** Main work finished with an error */
  Error: 'error',
} as const;
export type RunPhase = (typeof RunPhase)[keyof typeof RunPhase];

/** Features discovered by the feature-discovery subagent */
export const DiscoveredFeature = {
  Stripe: 'stripe',
  LLM: 'llm',
} as const;
export type DiscoveredFeature = (typeof DiscoveredFeature)[keyof typeof DiscoveredFeature];

/** Additional features the agent can integrate after the main setup */
export const AdditionalFeature = {
  LLM: 'llm',
} as const;
export type AdditionalFeature = (typeof AdditionalFeature)[keyof typeof AdditionalFeature];

/** Human-readable labels for additional features (used in TUI progress) */
export const ADDITIONAL_FEATURE_LABELS: Record<AdditionalFeature, string> = {
  [AdditionalFeature.LLM]: 'LLM analytics',
};

/** Agent prompts for each additional feature, injected via the stop hook */
export const ADDITIONAL_FEATURE_PROMPTS: Record<AdditionalFeature, string> = {
  [AdditionalFeature.LLM]: `Now integrate LLM analytics with Amplitude. Use the Amplitude MCP server to find the appropriate LLM analytics skill, install it, and follow its workflow. Amplitude basics are already installed. Update the setup report markdown file when complete with additions from this task. `,
};

/** Outcome of the MCP server installation step */
export const McpOutcome = {
  NoClients: 'no_clients',
  Skipped: 'skipped',
  Installed: 'installed',
  Failed: 'failed',
} as const;
export type McpOutcome = (typeof McpOutcome)[keyof typeof McpOutcome];

/** Outcome kind for the outro screen */
export const OutroKind = {
  Success: 'success',
  Error: 'error',
  Cancel: 'cancel',
} as const;
export type OutroKind = (typeof OutroKind)[keyof typeof OutroKind];

export interface OutroData {
  kind: OutroKind;
  message?: string;
  changes?: string[];
  docsUrl?: string;
  continueUrl?: string;
}

export interface WizardSession {
  // From CLI args
  debug: boolean;
  verbose: boolean;
  forceInstall: boolean;
  installDir: string;
  ci: boolean;
  signup: boolean;
  localMcp: boolean;
  apiKey?: string;
  menu: boolean;
  benchmark: boolean;
  projectId?: number;

  // From detection + screens
  setupConfirmed: boolean;
  integration: Integration | null;
  frameworkContext: Record<string, unknown>;
  typescript: boolean;

  /** Human-readable label for the detected framework variant (e.g., "Django with Wagtail CMS") */
  detectedFrameworkLabel: string | null;

  /** True once framework detection has run (whether it found something or not) */
  detectionComplete: boolean;

  /**
   * Whether the currently selected project has existing event data.
   * null = not yet checked (shown as DataSetup screen)
   * false = no data → route to Framework Detection
   * true = has data → route to Options menu
   */
  projectHasData: boolean | null;

  /**
   * Amplitude data-center region chosen by the user.
   * null = not yet selected (shown as RegionSelect screen)
   * 'us' = US region (api.amplitude.com)
   * 'eu' = EU region (api.eu.amplitude.com)
   */
  region: CloudRegion | null;

  /**
   * True when the /region slash command forces RegionSelect to re-appear.
   * Cleared once the user picks a region. After re-selection, projectHasData
   * is reset to null so the data setup step re-runs for the new region.
   */
  regionForced: boolean;

  /**
   * Orgs available after OAuth completes, before the user selects one.
   * null = OAuth not yet done (AuthScreen shows spinner)
   * [...] = OAuth done, AuthScreen showing org/workspace/key selection
   */
  pendingOrgs: Array<{
    id: string;
    name: string;
    workspaces: Array<{ id: string; name: string }>;
  }> | null;

  /** OAuth id_token held during SUSI account-setup steps. */
  pendingAuthIdToken: string | null;

  /** Cloud region detected from the OAuth token. Drives RegionSelect auto-skip. */
  pendingAuthCloudRegion: CloudRegion | null;

  /** Org selected during SUSI (written to ampli.json). */
  selectedOrgId: string | null;
  selectedOrgName: string | null;

  /** Workspace selected during SUSI (written to ampli.json). */
  selectedWorkspaceId: string | null;
  selectedWorkspaceName: string | null;

  // From OAuth
  credentials: {
    accessToken: string;
    projectApiKey: string;
    host: string;
    projectId: number;
  } | null;

  // Lifecycle
  runPhase: RunPhase;
  loginUrl: string | null;

  // Feature discovery
  discoveredFeatures: DiscoveredFeature[];
  llmOptIn: boolean;

  // Screen completion
  mcpComplete: boolean;
  mcpOutcome: McpOutcome | null;
  mcpInstalledClients: string[];

  // Runtime
  serviceStatus: { description: string; statusPageUrl: string } | null;
  settingsOverrideKeys: string[] | null;
  outroData: OutroData | null;

  // Additional features queue (drained via stop hook after main integration)
  additionalFeatureQueue: AdditionalFeature[];

  // Resolved framework config (set after integration is known)
  frameworkConfig: FrameworkConfig | null;
}

/**
 * Build a WizardSession from CLI args, pre-populating whatever is known.
 */
export function buildSession(args: {
  debug?: boolean;
  verbose?: boolean;
  forceInstall?: boolean;
  installDir?: string;
  ci?: boolean;
  signup?: boolean;
  localMcp?: boolean;
  apiKey?: string;
  menu?: boolean;
  integration?: Integration;
  benchmark?: boolean;
  projectId?: string;
}): WizardSession {
  return {
    debug: args.debug ?? false,
    verbose: args.verbose ?? false,
    forceInstall: args.forceInstall ?? false,
    installDir: args.installDir ?? process.cwd(),
    ci: args.ci ?? false,
    signup: args.signup ?? false,
    localMcp: args.localMcp ?? false,
    apiKey: args.apiKey,
    menu: args.menu ?? false,
    benchmark: args.benchmark ?? false,
    projectId: parseProjectIdArg(args.projectId),

    setupConfirmed: false,
    integration: args.integration ?? null,
    frameworkContext: {},
    typescript: false,
    detectedFrameworkLabel: null,
    detectionComplete: false,
    projectHasData: null,
    region: null,
    regionForced: false,

    runPhase: RunPhase.Idle,
    discoveredFeatures: [],
    llmOptIn: false,
    mcpComplete: false,
    mcpOutcome: null,
    mcpInstalledClients: [],
    pendingOrgs: null,
    pendingAuthIdToken: null,
    pendingAuthCloudRegion: null,
    selectedOrgId: null,
    selectedOrgName: null,
    selectedWorkspaceId: null,
    selectedWorkspaceName: null,
    loginUrl: null,
    credentials: null,
    serviceStatus: null,
    settingsOverrideKeys: null,
    outroData: null,
    additionalFeatureQueue: [],
    frameworkConfig: null,
  };
}
