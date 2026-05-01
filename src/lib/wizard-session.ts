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

import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { EMAIL_REGEX } from './constants';
import type { AmplitudeZone, Integration } from './constants';
import type { FrameworkConfig } from './framework-config';
import { resolveInstallDir } from '../utils/install-dir';

// ── Branded ID types ─────────────────────────────────────────────────────
//
// Why brand: prior bugs (see PR #62, "org data mapping") were caused by
// silently passing a workspace id where an app id was expected, or the other
// direction. The two are structurally `string` and `number` and TypeScript
// could not catch the mismatch. Branding them with `z.brand` gives us
// distinct nominal types without runtime cost — a raw `number` can no longer
// be assigned to an `AppId` slot without going through the parser/helper.

/**
 * Numeric Amplitude app id (canonical across Amplitude services).
 * Sourced from `App.id` in the Data API and `app_id` in the Python monorepo.
 */
export const AppIdSchema = z.number().int().positive().brand<'AppId'>();
export type AppId = z.infer<typeof AppIdSchema>;

/**
 * UUID-shaped Amplitude workspace id. Sourced from `Workspace.id` in the
 * Data API. Distinct from `selectedAppId` (string env app id) and the
 * stringified app id used in some MCP tool calls.
 */
export const WorkspaceIdSchema = z.string().min(1).brand<'WorkspaceId'>();
export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>;

/**
 * Construct an AppId from a raw number. Throws on invalid input — use at
 * trust boundaries (CLI parse, API response decoding, stored config).
 */
export function toAppId(value: number): AppId {
  return AppIdSchema.parse(value);
}

/**
 * Best-effort AppId construction. Returns undefined when the input cannot be
 * coerced to a positive integer. Use when accepting user-supplied strings.
 */
export function tryToAppId(
  value: string | number | null | undefined,
): AppId | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  const result = AppIdSchema.safeParse(n);
  return result.success ? result.data : undefined;
}

/**
 * Construct a WorkspaceId from a raw string. Throws on empty input — use at
 * trust boundaries. Most call sites get workspace ids from API responses
 * that have already been validated, so this just attaches the brand.
 */
export function toWorkspaceId(value: string): WorkspaceId {
  return WorkspaceIdSchema.parse(value);
}

/**
 * `credentials.appId` is `AppId | 0` — `0` is the "unknown" sentinel used
 * when OAuth produced credentials but the user has not yet picked an env.
 * This helper safely coerces raw input (string from CLI, number from API)
 * into the credentials shape: a branded AppId on success, `0` otherwise.
 *
 * Use at the trust boundary where credentials are constructed. After that,
 * the `AppId | 0` type prevents accidental cross-mixing with workspace ids
 * or other unrelated numbers — the same protection PR #62 motivated for
 * the top-level `WizardSession.appId`.
 */
export function toCredentialAppId(
  value: string | number | null | undefined,
): AppId | 0 {
  return tryToAppId(value) ?? 0;
}

/**
 * Zod schema for CLI args passed to `buildSession()`.
 * Coerces `appId` from string to a branded positive integer.
 * All boolean flags default to false; `installDir` defaults to cwd.
 */
export const CliArgsSchema = z.object({
  appId: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return undefined;
      const result = AppIdSchema.safeParse(Number(v));
      return result.success ? result.data : undefined;
    }),
  installDir: z
    .string()
    .default(() => process.cwd())
    // `resolveInstallDir` expands a leading `~` before resolving — bare
    // `path.resolve('~/foo')` does NOT expand `~` (Node treats it as a
    // literal directory name and joins onto cwd). Without this,
    // `--install-dir="~/foo"` from `~/bar` produces `~/bar/~/foo`.
    .transform((p) => resolveInstallDir(p)),
  debug: z.boolean().default(false),
  verbose: z.boolean().default(false),
  ci: z.boolean().default(false),
  agent: z.boolean().default(false),
  forceInstall: z.boolean().default(false),
  signup: z.boolean().default(false),
  localMcp: z.boolean().default(false),
  menu: z.boolean().default(false),
  benchmark: z.boolean().default(false),
  // Agent model tier. See `src/utils/types.ts:WizardMode` for the mapping.
  // Default 'standard' = current behavior (no change for existing users).
  mode: z.enum(['fast', 'standard', 'thorough']).default('standard'),
  apiKey: z.string().optional(),
  integration: z.string().optional(),
  appName: z.string().optional(),
  signupEmail: z
    .string()
    .regex(EMAIL_REGEX, 'Invalid email')
    .nullable()
    .optional()
    .default(null),
  signupFullName: z.string().nullable().optional().default(null),
  acceptTos: z.boolean().default(false),
  region: z.enum(['us', 'eu']).nullable().optional().default(null),
});

/**
 * Zod schema for validated Amplitude credentials.
 * Exported for incremental adoption at credential-construction sites.
 */
export const CredentialsSchema = z.object({
  accessToken: z.string().min(1, 'accessToken is required'),
  idToken: z.string().optional(),
  projectApiKey: z.string().min(1, 'projectApiKey is required'),
  host: z.string().url('host must be a valid URL'),
  /**
   * Numeric Amplitude app ID. Branded `AppId` on success or the literal
   * `0` sentinel when the env hasn't been picked yet. Construct via
   * `toCredentialAppId(value)` at the trust boundary.
   */
  appId: z.union([AppIdSchema, z.literal(0)]),
});

function parseAppIdArg(value: string | undefined): AppId | undefined {
  return tryToAppId(value);
}

export type CloudRegion = 'us' | 'eu';

/**
 * Lifecycle phase of the main work (agent run, MCP install, etc.)
 * NOTE: Duplicated in src/ui/tui/session-constants.ts (ESM/CJS workaround).
 * If you change these values, update that file too — a test enforces sync.
 */
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

/**
 * Status of a single post-agent step (commit planned events, create
 * dashboard, etc.) — work that runs between the Claude agent finishing
 * and the wizard transitioning to the MCP screen. Modeled separately
 * from agent TodoWrite tasks because these are framework-controlled,
 * not agent-controlled, and rendering them in the same list would break
 * the `syncTodos` "agent-authoritative" invariant.
 *
 * NOTE: Mirrored in src/ui/tui/session-constants.ts (ESM/CJS workaround).
 */
export const PostAgentStepStatus = {
  Pending: 'pending',
  InProgress: 'in_progress',
  Completed: 'completed',
  Skipped: 'skipped',
} as const;
export type PostAgentStepStatus =
  (typeof PostAgentStepStatus)[keyof typeof PostAgentStepStatus];

export interface PostAgentStep {
  /** Stable id (e.g. 'commit-events', 'create-dashboard') */
  id: string;
  /** Past-tense label shown when pending or completed. */
  label: string;
  /** Present-continuous label shown while in progress. */
  activeForm: string;
  status: PostAgentStepStatus;
  /** When `status === 'skipped'`, a short user-facing reason. */
  reason?: string;
  /** Wall-clock ms when this step transitioned to in_progress. */
  startedAt?: number;
}

/** Features discovered by the feature-discovery subagent */
export const DiscoveredFeature = {
  Stripe: 'stripe',
  LLM: 'llm',
  SessionReplay: 'session_replay',
  Engagement: 'engagement',
} as const;
export type DiscoveredFeature =
  (typeof DiscoveredFeature)[keyof typeof DiscoveredFeature];

/** Additional features the agent can integrate after the main setup */
export const AdditionalFeature = {
  LLM: 'llm',
  SessionReplay: 'session_replay',
  Engagement: 'engagement',
} as const;
export type AdditionalFeature =
  (typeof AdditionalFeature)[keyof typeof AdditionalFeature];

/** Human-readable labels for additional features (used in TUI progress) */
export const ADDITIONAL_FEATURE_LABELS: Record<AdditionalFeature, string> = {
  [AdditionalFeature.LLM]: 'LLM analytics',
  [AdditionalFeature.SessionReplay]: 'Session Replay',
  [AdditionalFeature.Engagement]: 'Guides & Surveys',
};

/** Agent prompts for each additional feature, injected via the stop hook */
export const ADDITIONAL_FEATURE_PROMPTS: Record<AdditionalFeature, string> = {
  [AdditionalFeature.LLM]: `Now integrate LLM analytics with Amplitude. Use the Amplitude MCP server to find the appropriate LLM analytics skill, install it, and follow its workflow. Amplitude basics are already installed. Update the setup report markdown file when complete with additions from this task. `,
  [AdditionalFeature.SessionReplay]: `The user wants to enable Amplitude Session Replay. Please configure it now:

1. If the project uses @amplitude/unified (preferred), add a sessionReplay block to the existing initAll() call: sessionReplay: { sampleRate: 1 }.
2. If the project uses @amplitude/analytics-browser standalone, install @amplitude/plugin-session-replay-browser and register it as a plugin with sampleRate: 1.
3. Do not add any comments about sample rates or production tuning.

After making changes, give a one-sentence summary of what was configured.`,
  [AdditionalFeature.Engagement]: `The user wants to enable Amplitude Guides & Surveys (the engagement plugin). Please configure it now:

1. If the project uses @amplitude/unified (preferred), add an engagement block to the existing initAll() call: engagement: {}. The empty object is sufficient — the plugin initializes with sensible defaults and reads remote config.
2. If the project uses @amplitude/analytics-browser standalone, install @amplitude/engagement-browser using the wizard-tools detect_package_manager output, then import { plugin as engagementPlugin } from '@amplitude/engagement-browser' and register it via amplitude.add(engagementPlugin()) before init().
3. Do not add config options the user didn't ask for. Do not add comments about server zone or production tuning.
4. Update the setup report markdown file when complete with what was configured.

After making changes, give a one-sentence summary of what was configured.`,
};

/**
 * Features that the agent configures inline as part of SDK initialization.
 * Their prompts are appended to the initial integration prompt and they are
 * NOT drained by the stop hook or rendered as separate task items.
 */
export const INLINE_FEATURES: ReadonlySet<AdditionalFeature> = new Set([
  AdditionalFeature.SessionReplay,
  AdditionalFeature.Engagement,
]);

/**
 * Features that run as a separate "Set up X" task after the main agent run,
 * drained one at a time via the stop hook and rendered as trailing task items.
 */
export const TRAILING_FEATURES: ReadonlySet<AdditionalFeature> = new Set([
  AdditionalFeature.LLM,
]);

/**
 * Discovered features that map to an opt-in AdditionalFeature.
 * Stripe is discovered but not opt-in — it's a passive doc link.
 */
export const OPT_IN_DISCOVERED_FEATURES: ReadonlySet<string> = new Set(
  Object.values(AdditionalFeature),
);

/** Outcome of the MCP server installation step */
export const McpOutcome = {
  NoClients: 'no_clients',
  Skipped: 'skipped',
  Installed: 'installed',
  Failed: 'failed',
} as const;
export type McpOutcome = (typeof McpOutcome)[keyof typeof McpOutcome];

/** Outcome of the Slack integration setup step */
export const SlackOutcome = {
  Skipped: 'skipped',
  Configured: 'configured',
} as const;
export type SlackOutcome = (typeof SlackOutcome)[keyof typeof SlackOutcome];

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
  promptLogin?: boolean;
  canRestart?: boolean;
}

/**
 * Transient state shown while the agent is retrying after a transient LLM /
 * proxy failure. Populated from `api_retry` SDK messages and the manual retry
 * sites in agent-interface.ts. Cleared when the next normal message arrives.
 */
export interface RetryState {
  /** 1-indexed attempt number that is about to begin. */
  attempt: number;
  /** Max retries the SDK / retry loop was configured with. */
  maxRetries: number;
  /** Absolute timestamp (ms) when the next retry will begin. */
  nextRetryAtMs: number;
  /** HTTP status code, when known (504, 400, …). `null` for stalls / SDK errors. */
  errorStatus: number | null;
  /** Short human-readable reason shown in the banner. */
  reason: string;
  /** Timestamp when this retry state was first set. */
  startedAt: number;
}

export interface WizardSession {
  // From CLI args
  debug: boolean;
  verbose: boolean;
  forceInstall: boolean;
  installDir: string;
  ci: boolean;
  agent: boolean;
  signup: boolean;
  signupEmail: string | null;
  signupFullName: string | null;
  localMcp: boolean;
  apiKey?: string;
  menu: boolean;
  benchmark: boolean;
  /** Agent model tier — 'fast' / 'standard' / 'thorough'. See WizardMode. */
  mode: import('../utils/types').WizardMode;

  /**
   * Free-form context the outer orchestrator wants prepended to every
   * agent turn. Sourced from `--context-file <path>` (or
   * `AMPLITUDE_WIZARD_CONTEXT` env var) at the CLI boundary; threaded
   * into `agent-interface.initializeAgent` and appended after the
   * commandments in the cached system-prompt block.
   *
   * Lets a parent agent inject team conventions ("we use snake_case for
   * events"), existing taxonomy hints, or project-specific instructions
   * WITHOUT modifying any skill content. The wizard treats it as
   * project-authoritative for conventions but never lets it override the
   * hard safety rules at the top of `commandments.ts`.
   *
   * `null` when no context was provided. Capped at the CLI boundary
   * (currently 64 KB) so a runaway file can't bloat the system prompt.
   */
  orchestratorContext: string | null;

  /**
   * UUID v4 generated once per wizard run. Forwarded to the Amplitude LLM
   * gateway as the `x-amp-wizard-session-id` header so every `/v1/messages`
   * call across the wizard's discrete agent phases (taxonomy, integration,
   * chart, dashboard) lands in a single Agent Analytics session. Without
   * this, the proxy falls back to a per-OAuth-token deterministic ID, which
   * collapses every wizard run a user has ever done into one session.
   */
  agentSessionId: string;
  /**
   * Numeric Amplitude app ID from --app-id (or --project-id alias).
   * Matches `app.id` in the Data API and `app_id` in the Python monorepo.
   * Branded — construct via `toAppId()` / `tryToAppId()` from raw input.
   */
  appId?: AppId;

  // From detection + screens
  setupConfirmed: boolean;
  integration: Integration | null;
  frameworkContext: Record<string, unknown>;
  /**
   * Order in which keys were written into `frameworkContext`. Tracks
   * answer history so back-navigation can pop the most recent setup
   * answer. Maintained by `WizardStore.setFrameworkContext` and
   * `popLastFrameworkContextAnswer`.
   */
  frameworkContextAnswerOrder: string[];
  typescript: boolean;

  /** Human-readable label for the detected framework variant (e.g., "Django with Wagtail CMS") */
  detectedFrameworkLabel: string | null;

  /** True once framework detection has run (whether it found something or not) */
  detectionComplete: boolean;

  /** Full results from parallel detection (all frameworks). Available for diagnostics. */
  detectionResults: Array<{
    integration: Integration;
    detected: boolean;
    durationMs: number;
    timedOut: boolean;
    error?: string;
    version?: string;
  }> | null;

  /**
   * Whether the currently selected project has existing event data.
   * null = not yet checked (shown as DataSetup screen)
   * false = no data → route to Framework Detection
   * true = has data → route to Options menu
   */
  projectHasData: boolean | null;

  /**
   * Project selected during SUSI (written to ampli.json as ProjectId).
   *
   * NOTE: Amplitude's backend GraphQL schema still calls this concept a
   * "workspace" (Org → Workspace → Environment → App in the Data API),
   * but every user-facing surface — the website UI, docs, slash commands,
   * and analytics properties — uses "project". These session fields and
   * ampli.json use "project" to match.
   */
  selectedProjectId: string | null;
  selectedProjectName: string | null;

  /**
   * Activation level determined by the API check.
   * null  = not yet checked
   * 'none'    = 0 events, snippet not configured → Framework Detection
   * 'partial' = 1–49 events or snippet installed but limited events → ActivationOptions
   * 'full'    = well-established data (50+ events) → Options
   */
  activationLevel: 'none' | 'partial' | 'full' | null;

  /**
   * True when the local pre-flight check (`isProjectFullyWired`) found a
   * complete prior install — SDK in package.json, source import present,
   * `ampli.json` with org/project scope, and a non-empty event plan on
   * disk. Set alongside `activationLevel = 'full'` so the router's
   * Setup/Run skip predicates fire, but DataIngestionCheck STILL polls
   * (the user may have just re-run pre-deploy, with no remote events
   * yet). Distinct from a remote-confirmed `'full'` activation, which
   * skips the polling screen too.
   */
  localInstrumentationComplete: boolean;

  /** True once the user has responded to the ActivationOptions screen. */
  activationOptionsComplete: boolean;

  /** Whether the SDK snippet is installed in the project (set by DataSetupScreen). */
  snippetConfigured: boolean;

  /**
   * Amplitude data-center region chosen by the user.
   * null = not yet selected (shown as RegionSelect screen)
   * 'us' = US region (api.amplitude.com)
   * 'eu' = EU region (api.eu.amplitude.com)
   *
   * WRITE INVARIANT: this field is written ONLY by intent-bearing sources —
   * the --region CLI flag / env var, /region slash command, RegionSelect
   * screen pick, the "Switch data-center region" flow, checkpoint restore,
   * and OAuth-derived zone after successful authentication (signing into an
   * EU account is regional intent, even though it's not a manual pick).
   * Non-intent code MUST NOT assign to this field as a cache.
   *
   * READ GUIDANCE: code outside the TUI render tree (bin.ts entry points,
   * credential-resolution, agent/CI paths) MUST call
   * `resolveZone(session, fallback)` (src/lib/zone-resolution.ts) to get
   * the effective zone, not read this field directly. The only legitimate
   * direct reads are: display/debug output, checkpoint persistence (we
   * persist intent, not resolved zone), and the RegionSelect gate checks
   * in bin.ts that drive pre-auth flow ordering.
   */
  region: AmplitudeZone | null;

  /**
   * True when the /region slash command forces RegionSelect to re-appear.
   * Cleared once the user picks a region. After re-selection, projectHasData
   * is reset to null so the data setup step re-runs for the new region.
   */
  regionForced: boolean;

  /**
   * Orgs available after OAuth completes, before the user selects one.
   * null = OAuth not yet done (AuthScreen shows spinner)
   * [...] = OAuth done, AuthScreen showing org/project/key selection
   */
  pendingOrgs: Array<{
    id: string;
    name: string;
    projects: Array<{
      id: string;
      name: string;
      environments?: Array<{
        name: string;
        rank: number;
        app: { id: string; apiKey?: string | null } | null;
      }> | null;
    }>;
  }> | null;

  /** OAuth id_token held during SUSI account-setup steps. */
  pendingAuthIdToken: string | null;

  /** OAuth access_token held during SUSI — used for Hydra-validated proxy auth. */
  pendingAuthAccessToken: string | null;

  /**
   * Set by `resolveCredentials` when the user passed a scope filter
   * (`--app-id`, `--project-id`, etc.) that didn't match any known
   * environment. Drives the structured `auth_required: env_selection_failed`
   * emission in agent mode: the orchestrator gets back the bad value it
   * passed AND the candidate list in one event, instead of having to
   * re-discover environments after a silent fall-through to auto-select.
   *
   * `null` when no scope filters were specified (multi-env path) or
   * filters matched cleanly (success path).
   */
  scopeFilterMismatch: {
    flag: '--app-id' | '--project-id' | '--env' | '--org';
    value: string;
    /** Plain-language explanation: "no environment with appId=99999". */
    reason: string;
  } | null;

  /** Org selected during SUSI (written to ampli.json). */
  selectedOrgId: string | null;
  selectedOrgName: string | null;

  /**
   * Amplitude environment name (e.g. "Production", "Development", "Staging")
   * for the selected project — displayed in the TitleBar.
   *
   * The environment's `app.id` is what Amplitude's UI labels "Project ID"
   * in some places — each environment has its own numeric app ID and its
   * own API key. This field stores the env NAME, not an app ID.
   */
  selectedEnvName: string | null;

  /**
   * Numeric Amplitude app ID for the selected environment (e.g. "769610").
   * Sourced from `workspace.environments[*].app.id`. Canonical term across
   * amplitude/amplitude (Python `app_id`) and amplitude/javascript
   * (TS `appId`, GraphQL `App.id`). Used by DataIngestionCheckScreen to
   * call query_dataset via MCP.
   */
  selectedAppId: string | null;

  /**
   * Notice shown on the API key entry step of AuthScreen.
   * Set when auto-fetch fails (e.g. user is not an org admin) so the user
   * understands why manual entry is required.
   */
  apiKeyNotice: string | null;

  // From OAuth
  credentials: {
    accessToken: string;
    /** id_token from OAuth — used for Amplitude Data API calls */
    idToken?: string;
    projectApiKey: string;
    host: string;
    /**
     * Numeric Amplitude app ID (canonical). Branded `AppId` once an env is
     * known; `0` is the "unknown" sentinel set when OAuth produced
     * credentials but no env has been picked yet. Construct via
     * `toCredentialAppId(value)` at the trust boundary so raw `Number(x)`
     * conversions can't sneak past the brand. PR #62 ("org data mapping")
     * was the original motivation for branding the related top-level fields.
     */
    appId: AppId | 0;
  } | null;

  /**
   * Ordered queue of framework-controlled steps that run after the
   * Claude agent finishes (commit planned events, create dashboard,
   * etc.). Rendered as the FinalizingPanel under the agent task list
   * so the user sees forward motion during what would otherwise be a
   * silent post-agent gap. Empty until the agent run completes; never
   * re-ordered after seeding.
   */
  postAgentSteps: PostAgentStep[];

  // Lifecycle
  runPhase: RunPhase;
  /**
   * Wall-clock timestamp (ms) when runPhase first transitioned to Running.
   * Null while Idle / before the run starts. Used by the Run screen to
   * compute elapsed time that persists across tab re-mounts.
   */
  runStartedAt: number | null;
  loginUrl: string | null;

  // Feature discovery
  discoveredFeatures: DiscoveredFeature[];
  llmOptIn: boolean;
  sessionReplayOptIn: boolean;
  engagementOptIn: boolean;

  /** True once the user has clicked Continue on the IntroScreen. */
  introConcluded: boolean;

  /**
   * Set to `true` when credentials were resolved silently from disk on a
   * returning run (stored OAuth + persisted API key + ampli.json), instead
   * of being chosen by the user in the SUSI picker this session.
   *
   * The Auth flow gate refuses to advance while this is true — AuthScreen
   * shows a one-shot confirmation step ("continue with org X / project Y,
   * or change") so the user is never silently routed against a project
   * they didn't intend to target. Cleared once they confirm or pick a
   * different project.
   *
   * Forced false in non-interactive modes (`ci` / `agent`) where there is
   * no human to confirm. Those modes already accept the stored selection
   * (or fail loudly via `auth_required: env_selection_failed`).
   */
  requiresAccountConfirmation: boolean;

  /**
   * True from the moment the user invokes `/logout` until the logout flow
   * completes (or is cancelled). Used by the bin.ts re-auth watcher to skip
   * the auto-OAuth retry that would otherwise fire during the brief window
   * where credentials are null but the Logout overlay has not yet been
   * fully resolved as `currentScreen`. Without this flag the watcher could
   * race the logout flow and re-open the browser unexpectedly.
   */
  loggingOut: boolean;

  // Screen completion
  mcpComplete: boolean;
  mcpOutcome: McpOutcome | null;
  mcpInstalledClients: string[];
  slackComplete: boolean;
  slackOutcome: SlackOutcome | null;

  // Runtime
  serviceStatus: { description: string; statusPageUrl: string } | null;
  retryState: RetryState | null;
  outroData: OutroData | null;

  // Additional features queue (drained via stop hook after main integration)
  additionalFeatureQueue: AdditionalFeature[];

  /** The feature currently being processed by the stop hook, if any. */
  additionalFeatureCurrent: AdditionalFeature | null;

  /** Features the stop hook has finished processing, in order. */
  additionalFeatureCompleted: AdditionalFeature[];

  /**
   * True once feature-opt-in resolution has run for this session. The
   * wizard auto-enables every discovered opt-in addon (Session Replay,
   * Guides & Surveys, LLM-when-flag-on) at discovery time rather than
   * showing a picker — this flag is flipped to true alongside that
   * auto-enable so any flow predicate that gates on
   * `optInFeaturesComplete` (and was originally written for the old
   * picker world) still resolves correctly.
   */
  optInFeaturesComplete: boolean;

  // Resolved framework config (set after integration is known)
  frameworkConfig: FrameworkConfig | null;

  /**
   * True when the agent run was skipped because Amplitude was already
   * detected in the project via static analysis. Set in bin.ts before
   * runPhase is set to Completed.
   */
  amplitudePreDetected: boolean;

  /**
   * While true, McpScreen shows a prompt: skip the agent (default) or run
   * the setup wizard anyway. Cleared when the user chooses or when resetting
   * for a forced wizard run.
   */
  amplitudePreDetectedChoicePending: boolean;

  // Data ingestion + post-setup checklist
  /**
   * True once the activation check confirms events are flowing into the project.
   * Set immediately if activationLevel is already 'full', otherwise set after
   * the DataIngestionCheckScreen detects events via the API.
   */
  dataIngestionConfirmed: boolean;

  /**
   * URL of the dashboard created by the agent during the conclude phase.
   * Set when the agent writes .amplitude-dashboard.json and the watcher
   * picks it up. Shown in OutroScreen as a direct link.
   * Null until the agent creates a dashboard.
   */
  checklistDashboardUrl: string | null;

  /**
   * Lifecycle phase of the post-agent dashboard fallback step
   * (`createDashboardStep` in src/steps/create-dashboard.ts).
   *
   *   `null`         — fallback hasn't started, or the agent already produced
   *                    `.amplitude/dashboard.json` so the fallback short-circuits.
   *   `in_progress`  — fallback is actively running its sub-agent + MCP calls.
   *                    RunScreen surfaces this as a 6th synthetic task so the
   *                    "X / 5 tasks complete" header stops lying while the
   *                    spinner is spinning.
   *   `completed`    — fallback finished (success or graceful skip).
   *
   * When the in-loop agent calls `record_dashboard` (the post-#PR-XXX path),
   * this field stays null end-to-end and the RunScreen never shows a 6th task.
   * The 6th task only appears when the agent didn't do its job and the
   * fallback actually fires — that's the rare case we still want to be
   * transparent about.
   */
  dashboardFallbackPhase: 'in_progress' | 'completed' | null;

  /**
   * Browser magic-link URL from `--signup` provisioning (`dashboard_url` on
   * the agentic signup API). Never log or NDJSON (query may contain secrets).
   */
  signupMagicLinkUrl: string | null;

  /** Email address of the authenticated user (from ~/.ampli.json stored profile). */
  userEmail: string | null;

  /**
   * Set to true by bin.ts when a crash-recovery checkpoint is loaded.
   * IntroScreen checks this to show a "Resume where you left off" prompt
   * instead of the normal detection flow.
   */
  _restoredFromCheckpoint: boolean;

  /**
   * Terms of Service acceptance state for --signup flow.
   * null = not yet shown/needed (default)
   * false = shown but not yet accepted
   * true = accepted by user
   */
  tosAccepted: boolean | null;

  /**
   * True once the email capture step is complete in the --signup flow.
   * Email is required before showing ToS.
   */
  emailCaptureComplete: boolean;

  /**
   * True if signup tokens were already obtained during EmailCaptureScreen
   * (to skip duplicate signup attempt in bin.ts)
   */
  signupTokensObtained: boolean;

  /**
   * Create-project flow state.
   *
   * `pending` = the user has chosen "Create new project…" from the Auth
   *   picker or invoked `/create-project`. The CreateProjectScreen should
   *   render and collect a name.
   * `null` = not in the create-project flow (default).
   *
   * The picker that triggered the flow is tracked for analytics + so we
   * can route back to the right picker on cancel.
   *
   * We intentionally do NOT store the returned apiKey on the session
   * here — it flows through `setCredentials()` instead (same path as all
   * other API keys) so redaction and persistence stay consistent.
   */
  createProject: {
    /** True when the CreateProjectScreen should be shown. */
    pending: boolean;
    /** Which picker triggered it — used for analytics + cancel routing. */
    source: 'project' | 'environment' | 'slash' | 'cli-flag' | null;
    /** Pre-filled name (e.g. from --project-name CLI flag). */
    suggestedName: string | null;
  };
}

// ── Phase-narrowed session views ─────────────────────────────────────────
//
// `WizardSession` is a flat shape with ~40 optional fields. Many fields are
// only meaningful in a specific phase (credentials in authenticated, app id
// in configured, integration in running). The guards below let callers
// adopt a discriminated-union view incrementally — pass a session through a
// guard once and the narrowed body can rely on the phase-relevant fields
// being non-null without defensive checks scattered across consumers.

/**
 * Session view after OAuth completes: credentials and an org are set.
 * Fields outside the auth subset remain optional/nullable as in
 * `WizardSession`.
 */
export type AuthenticatedSession = WizardSession & {
  credentials: NonNullable<WizardSession['credentials']>;
  selectedOrgId: string;
};

/**
 * Session view once the user has chosen an org/project and a region.
 * This is the minimum needed to talk to the Amplitude Data API.
 */
export type ConfiguredSession = AuthenticatedSession & {
  selectedProjectId: string;
  region: AmplitudeZone;
};

/**
 * Session view while the agent is actively running. Adds an integration
 * and a non-null run start timestamp to the configured baseline.
 */
export type RunningSession = ConfiguredSession & {
  runPhase: typeof RunPhase.Running;
  integration: Integration;
  runStartedAt: number;
};

/**
 * True iff OAuth has produced credentials and an org id is recorded.
 * Callers that only need credentials can use this and stop sprinkling
 * `if (!session.credentials)` early-returns.
 */
export function isAuthenticated(
  session: WizardSession,
): session is AuthenticatedSession {
  return session.credentials !== null && session.selectedOrgId !== null;
}

/**
 * True iff the session has everything needed to make scoped Data API calls:
 * credentials + org + project + region.
 */
export function isConfigured(
  session: WizardSession,
): session is ConfiguredSession {
  return (
    isAuthenticated(session) &&
    session.selectedProjectId !== null &&
    session.region !== null
  );
}

/**
 * True iff the agent run is currently in flight. Used by retry/error paths
 * that should only act on a live run.
 */
export function isRunning(session: WizardSession): session is RunningSession {
  return (
    session.runPhase === RunPhase.Running &&
    isConfigured(session) &&
    session.integration !== null &&
    session.runStartedAt !== null
  );
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
  /** Agent model tier — 'fast' / 'standard' / 'thorough'. Defaults to 'standard'. */
  mode?: import('../utils/types').WizardMode;
  /** From --app-id / --project-id CLI flag. */
  appId?: string;
  /** From --app-name / --project-name CLI flag — pre-fills CreateAppScreen. */
  appName?: string;
  signupEmail?: string;
  signupFullName?: string;
  /**
   * From --accept-tos CLI flag. Explicit consent to the Amplitude Terms of
   * Service. Required (alongside --email / --full-name / --region) when
   * --signup is used in --ci or --agent modes; in TUI mode the ToSScreen
   * still owns the consent UI, so this flag pre-accepts and skips that
   * screen. Pre-populates `session.tosAccepted = true` when passed.
   */
  acceptTos?: boolean;
  /**
   * From --region CLI flag (--zone is accepted as an alias). Lets non-TUI
   * modes (agent/CI/classic) pick the data center for direct signup, since
   * they have no RegionSelect screen. When provided, pre-populates the
   * session's region so RegionSelect is skipped in the TUI flow too.
   */
  region?: AmplitudeZone;
}): WizardSession {
  // Validate CLI args via Zod — warn on bad input but fall back to defaults
  const parsed = CliArgsSchema.safeParse(args);
  if (!parsed.success) {
    console.warn(
      `[wizard] Invalid CLI args (falling back to defaults): ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join(', ')}`,
    );
  }

  // Use Zod-validated data (with coerced appId and defaults) when available
  const validated = parsed.success ? parsed.data : args;

  return {
    debug: validated.debug ?? false,
    verbose: validated.verbose ?? false,
    forceInstall: validated.forceInstall ?? false,
    installDir: resolveInstallDir(validated.installDir),
    ci: validated.ci ?? false,
    agent: false,
    signup: validated.signup ?? false,
    // On parse failure we intentionally reject raw args for the signup
    // fields — otherwise a malformed email would skip zod's .email() check
    // via the fallback and reach the signup endpoint. Null here means the
    // signup wrapper short-circuits with "missing email or fullName".
    signupEmail: parsed.success ? validated.signupEmail ?? null : null,
    signupFullName: parsed.success ? validated.signupFullName ?? null : null,
    localMcp: validated.localMcp ?? false,
    apiKey: validated.apiKey,
    menu: validated.menu ?? false,
    benchmark: validated.benchmark ?? false,
    mode: validated.mode ?? 'standard',
    // The CLI boundary stamps this directly on the session after
    // buildSession returns; default to null here so unit tests and any
    // other buildSession caller that doesn't wire `--context-file`
    // start with a known-empty value.
    orchestratorContext: null,
    appId: parsed.success ? parsed.data.appId : parseAppIdArg(args.appId),

    // Stable across the entire wizard run; forwarded to the LLM gateway as
    // x-amp-wizard-session-id so every /v1/messages call shares one Agent
    // Analytics session.
    agentSessionId: randomUUID(),

    setupConfirmed: false,
    integration: (validated.integration as Integration) ?? null,
    frameworkContext: {},
    frameworkContextAnswerOrder: [],
    typescript: false,
    detectedFrameworkLabel: null,
    detectionComplete: false,
    detectionResults: null,
    projectHasData: null,
    activationLevel: null,
    localInstrumentationComplete: false,
    activationOptionsComplete: false,
    snippetConfigured: false,
    // --region (alias: --zone) pre-populates region so non-TUI signup
    // targets the right DC. Same parse-failure guard as signupEmail above.
    region: parsed.success ? validated.region ?? null : null,
    regionForced: false,

    postAgentSteps: [],
    runPhase: RunPhase.Idle,
    runStartedAt: null,
    discoveredFeatures: [],
    llmOptIn: false,
    sessionReplayOptIn: false,
    engagementOptIn: false,
    loggingOut: false,
    mcpComplete: false,
    mcpOutcome: null,
    mcpInstalledClients: [],
    slackComplete: false,
    slackOutcome: null,
    pendingOrgs: null,
    pendingAuthIdToken: null,
    pendingAuthAccessToken: null,
    scopeFilterMismatch: null,
    selectedOrgId: null,
    selectedOrgName: null,
    selectedProjectId: null,
    selectedProjectName: null,
    selectedEnvName: null,
    selectedAppId: null,
    loginUrl: null,
    credentials: null,
    apiKeyNotice: null,
    serviceStatus: null,
    retryState: null,
    outroData: null,
    introConcluded: false,
    requiresAccountConfirmation: false,
    additionalFeatureQueue: [],
    additionalFeatureCurrent: null,
    additionalFeatureCompleted: [],
    optInFeaturesComplete: false,
    frameworkConfig: null,
    amplitudePreDetected: false,
    amplitudePreDetectedChoicePending: false,

    dataIngestionConfirmed: false,
    checklistDashboardUrl: null,
    dashboardFallbackPhase: null,
    signupMagicLinkUrl: null,

    userEmail: null,
    _restoredFromCheckpoint: false,

    // --accept-tos pre-accepts ToS for non-TUI signup; in TUI mode the
    // ToSScreen still owns the UX but its `isComplete` check sees `true`
    // and skips. Email capture is independently flagged below.
    tosAccepted: validated.acceptTos === true ? true : null,
    emailCaptureComplete: false,
    signupTokensObtained: false,

    createProject: {
      pending: false,
      source: args.appName ? 'cli-flag' : null,
      suggestedName: args.appName ?? null,
    },
  };
}
