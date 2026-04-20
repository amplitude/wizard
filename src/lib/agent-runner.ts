import {
  DEFAULT_PACKAGE_INSTALLATION,
  SPINNER_MESSAGE,
  type FrameworkConfig,
} from './framework-config';
import {
  type WizardSession,
  OutroKind,
  type AdditionalFeature,
  ADDITIONAL_FEATURE_PROMPTS,
  ADDITIONAL_FEATURE_LABELS,
  INLINE_FEATURES,
} from './wizard-session';
import {
  tryGetPackageJson,
  isUsingTypeScript,
  getOrAskForProjectData,
} from '../utils/setup-utils';
import type { PackageDotJson } from '../utils/package-json';
import type { WizardOptions } from '../utils/types';
import { analytics, captureWizardError } from '../utils/analytics';
import { getUI } from '../ui';
import {
  getAgent,
  runAgent,
  AgentErrorType,
  buildWizardMetadata,
} from './agent-interface';
import { getLlmGatewayUrlFromHost } from '../utils/urls';
import { DEFAULT_AMPLITUDE_ZONE, OUTBOUND_URLS } from './constants.js';
import { resolveZone } from './zone-resolution.js';
import { getVersionCheckInfo, getVersionWarning } from './version-check';

import * as fsSync from 'fs';
import path from 'path';
import { saveCheckpoint } from './session-checkpoint.js';
import { enableDebugLogs, logToFile } from '../utils/debug';
import { getLogFilePath } from './observability/index.js';
import { createObservabilityMiddleware } from './middleware/observability';
import { MiddlewarePipeline } from './middleware/pipeline';
import { createBenchmarkPipeline } from './middleware/benchmark';
import { createRetryMiddleware } from './middleware/retry';
import {
  wizardAbort,
  WizardError,
  getWizardAbortSignal,
} from '../utils/wizard-abort';
import { ExitCode } from './exit-codes';
import { GENERIC_AGENT_CONFIG } from '../frameworks/generic/generic-wizard-agent';

/** Single source of truth for the support address shown in error messages. */
const SUPPORT_EMAIL = 'wizard@amplitude.com';

/**
 * Build the "you can bypass the Amplitude gateway with a direct Anthropic
 * key" hint shown in upstream-failure error messages. Shared by the
 * GATEWAY_DOWN, terminated-400, rate-limit, and generic API_ERROR branches —
 * all four are the same class of upstream-side problem from the user's
 * perspective, so they should offer the same workaround.
 */
function buildGatewayBypassHint(): string {
  const usingDirectKey = !!process.env.ANTHROPIC_API_KEY;
  return usingDirectKey
    ? `You're already using a direct Anthropic API key, so this is likely an Anthropic-side issue. Wait a few minutes and re-run.`
    : `Workaround: re-run with a direct Anthropic API key to bypass the Amplitude gateway:\n  ANTHROPIC_API_KEY=sk-ant-... npx @amplitude/wizard\n\nOr wait a few minutes and try again — gateway incidents typically resolve quickly.`;
}

/**
 * Sentry subtype tags we attach to `API_ERROR` / `RATE_LIMIT` runs so we can
 * group and alert on each upstream-shape separately. See
 * {@link classifyApiErrorSubtype} for the rules.
 */
export type ApiErrorSubtype =
  | 'stream_closed'
  | 'terminated_400'
  | 'rate_limit'
  | 'other';

/**
 * Classify a surfaced API error into a Sentry-friendly subtype tag.
 *
 *   - `stream_closed`  — Hook bridge race during prior-attempt teardown
 *                        (issue #297). PR #298 drains the prior iterator
 *                        and treats this as transient inside the inner
 *                        retry loop, so seeing it surface here means
 *                        every retry exhausted with the same race —
 *                        strong signal that the drain isn't fully
 *                        effective and we need a deeper fix.
 *   - `terminated_400` — Vertex/Anthropic killed the request mid-flight.
 *                        Slipped past the GATEWAY_DOWN guard because
 *                        earlier attempts had succeeded. (Sentry #7442894144)
 *   - `rate_limit`     — Wizard exhausted retries against a 429 storm.
 *   - `other`          — Unclassified API error. Catch-all.
 *
 * Pure for unit testing — no side effects. Exported so the
 * agent-runner test can lock down the matching rules without standing up
 * the full agent runtime.
 */
export function classifyApiErrorSubtype(input: {
  errorType: AgentErrorType;
  message: string;
}): ApiErrorSubtype {
  // Order matters: `stream_closed` first so a rate-limit message that
  // happens to mention "stream closed" still classifies as the more
  // specific bridge-race signal. In practice these strings are mutually
  // exclusive on the rawMessage we receive, but the ordering makes the
  // intent explicit.
  if (/stream\s+closed/i.test(input.message)) return 'stream_closed';
  if (/400\s+terminated/i.test(input.message)) return 'terminated_400';
  if (input.errorType === AgentErrorType.RATE_LIMIT) return 'rate_limit';
  return 'other';
}

/**
 * Decide whether a late-stage API failure should be treated as a soft
 * error (continue to MCP / outro) or a hard abort (wizardAbort).
 *
 * The agent stream can throw `API_ERROR` / `RATE_LIMIT` AFTER it has
 * already done all the meaningful work — common shapes:
 *   - dashboard MCP create succeeded, then a final flush hits a 429
 *   - setup-report.md was written, then the stream closed mid-tear-down
 *   - hook bridge fired its last event after the agent yielded
 *
 * In those cases the user's project is in a fully-set-up state. We
 * shouldn't punish them with a network error code and skip the MCP /
 * Slack / Outro screens — the wizard's job is done.
 *
 * Heuristic: the dashboard URL on the session is the most reliable
 * "we got past the long pole" signal. The dashboard MCP call happens
 * last in the agent's conclude phase, after events have been
 * instrumented and the setup report has been drafted. If the URL is
 * present, everything else is too.
 */
export function agentArtifactsLookComplete(session: WizardSession): boolean {
  return Boolean(session.checklistDashboardUrl);
}

/**
 * Heuristic: did the agent at least install the SDK and instrument
 * events, even if it didn't reach the dashboard creation step?
 *
 * The wizard's `confirm_event_plan` MCP tool persists the approved
 * event plan to `<installDir>/.amplitude-events.json` (see
 * `persistEventPlan` in `wizard-tools.ts`). That file's presence with
 * non-empty content is a hard signal that:
 *
 *   - The user approved an instrumentation plan
 *   - The agent reached the post-confirmation phase
 *   - Track call insertion was attempted (whether or not every callsite
 *     landed cleanly — but typically by this point it has)
 *
 * Used as a complement to `agentArtifactsLookComplete` for failure modes
 * where the dashboard URL is NOT set but the project is still in a
 * usable instrumented state — most commonly: the Amplitude MCP server
 * (mcp.amplitude.com) is unreachable at the END of the run, after the
 * events were instrumented but before the dashboard could be created.
 *
 * Distinct from `agentArtifactsLookComplete` because that function's
 * "complete" includes dashboard. This one's "instrumented" stops at the
 * code-changes phase. Dashboard-failed-but-everything-else-worked is a
 * meaningfully different state — the user has working analytics; the
 * only loss is the auto-built dashboard. They can build one manually at
 * app.amplitude.com.
 */
export function agentEventsInstrumented(session: WizardSession): boolean {
  try {
    const eventsPath = path.join(session.installDir, '.amplitude-events.json');
    if (!fsSync.existsSync(eventsPath)) return false;
    const raw = fsSync.readFileSync(eventsPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

/**
 * Hard-error abort for `API_ERROR` / `RATE_LIMIT` agent failures.
 * Extracted from the runAgentWizardBody inline branch so the soft-error
 * path can early-return without duplicating this logic.
 */
async function abortOnApiError(
  errorType: AgentErrorType.API_ERROR | AgentErrorType.RATE_LIMIT,
  rawMessage: string,
  config: FrameworkConfig,
): Promise<never> {
  // Subtype within API_ERROR — these all share the "upstream dropped
  // something" root cause but reach this branch by different paths:
  //
  //   terminated_400  — Vertex/Anthropic killed the request mid-flight.
  //                     Slipped past the GATEWAY_DOWN guard because
  //                     earlier attempts had succeeded. (Sentry #7442894144)
  //   stream_closed   — Hook bridge race during prior-attempt teardown
  //                     (issue #297). #298 drains the prior iterator
  //                     and treats this as transient inside the inner
  //                     retry loop, so seeing it surface here means
  //                     every retry exhausted with the same bridge
  //                     race — strong signal that the drain isn't
  //                     fully effective and we need a deeper fix.
  //   rate_limit      — Wizard exhausted retries against a 429 storm.
  //   other           — Unclassified API error. Catch-all.
  const errorSubtype = classifyApiErrorSubtype({
    errorType,
    message: rawMessage,
  });

  captureWizardError(
    'Agent API',
    rawMessage || 'Unknown API error',
    'agent-runner',
    {
      integration: config.metadata.integration,
      'error type': errorType,
      'error subtype': errorSubtype,
      'using direct key': !!process.env.ANTHROPIC_API_KEY,
    },
  );

  let userMessage: string;
  switch (errorSubtype) {
    case 'stream_closed':
      userMessage = `LLM gateway connection lost\n\nThe wizard couldn't keep a stable connection to the Amplitude LLM gateway across retries (${rawMessage}). Re-running the wizard usually clears this up.\n\n${buildGatewayBypassHint()}\n\nIf this persists, please report it (with ${getLogFilePath()}) to: ${SUPPORT_EMAIL}`;
      break;
    case 'terminated_400':
      userMessage = `LLM gateway dropped the connection\n\nThe Amplitude LLM gateway terminated the request mid-flight (${rawMessage}). Some progress was made before this happened — re-running the wizard usually finishes the job.\n\n${buildGatewayBypassHint()}\n\nIf this persists, please report it (with ${getLogFilePath()}) to: ${SUPPORT_EMAIL}`;
      break;
    case 'rate_limit':
      userMessage = `Rate limit reached\n\nThe LLM gateway is rate-limiting requests (${
        rawMessage || 'API Error: 429'
      }). Wait a minute or two and re-run the wizard.\n\n${buildGatewayBypassHint()}`;
      break;
    case 'other':
      userMessage = `LLM gateway error\n\n${
        rawMessage || 'Unknown error'
      }\n\nThis is typically an upstream issue with the Amplitude LLM gateway, not your project. Re-running the wizard usually works.\n\n${buildGatewayBypassHint()}\n\nIf this persists, please report it (with ${getLogFilePath()}) to: ${SUPPORT_EMAIL}`;
      break;
  }

  await wizardAbort({
    message: userMessage,
    error: new WizardError(`API error: ${rawMessage || 'unknown'}`, {
      integration: config.metadata.integration,
      'error type': errorType,
      'error subtype': errorSubtype,
      // Preserves the structured `report_status` detail / underlying
      // agentResult.message that produced this branch — without it
      // Sentry only sees the boilerplate `userMessage` copy, which
      // doesn't disambiguate between subtypes for debugging.
      'agent error detail': rawMessage || null,
    }),
    exitCode: ExitCode.NETWORK_ERROR,
  });
  // wizardAbort returns Promise<never>, but TypeScript can't always
  // narrow that through an async function — explicit throw keeps
  // downstream type checking happy.
  throw new Error('unreachable');
}

/**
 * Build a WizardOptions bag from a WizardSession (for code that still expects WizardOptions).
 */
function sessionToOptions(session: WizardSession): WizardOptions {
  return {
    installDir: session.installDir,
    debug: session.debug,
    forceInstall: session.forceInstall,
    default: false,
    signup: session.signup,
    localMcp: session.localMcp,
    ci: session.ci,
    menu: session.menu,
    benchmark: session.benchmark,
    appId: session.appId,
    apiKey: session.apiKey,
  };
}

/**
 * Universal agent-powered wizard runner.
 * Handles the complete flow for any framework using Amplitude MCP integration.
 *
 * All user decisions come from the session — no UI prompts.
 */
export async function runAgentWizard(
  config: FrameworkConfig,
  session: WizardSession,
  getAdditionalFeatureQueue?: () => readonly AdditionalFeature[],
  featureProgress?: {
    onFeatureStart?: (feature: AdditionalFeature) => void;
    onFeatureComplete?: (feature: AdditionalFeature) => void;
  },
): Promise<void> {
  if (session.debug) {
    enableDebugLogs();
  }

  // Ensure the wizard's artifacts (event plan + the single-use integration
  // skill + the kept-on-disk instrumentation/taxonomy skills) are gitignored
  // before anything is installed. Idempotent — safe to call on every run.
  // Without this, `git status` after a run is full of wizard scaffolding
  // and `git add .` sweeps it into the user's commits.
  const {
    ensureWizardArtifactsIgnored,
    cleanupWizardArtifacts,
    writeFallbackReportIfMissing,
    archiveSetupReportFile,
    restoreSetupReportIfMissing,
  } = await import('./wizard-tools.js');
  ensureWizardArtifactsIgnored(session.installDir);

  // Move any prior `amplitude-setup-report.md` to
  // `amplitude-setup-report.previous.md` BEFORE the run starts so the
  // outro never advertises a stale report from a previous run (e.g.
  // against a different workspace) as if it described THIS run. The
  // fresh report still lands at the canonical filename when the agent
  // reaches its conclude phase; if it never gets there (full activation,
  // cancel, etc.) the canonical filename stays absent and the outro
  // hides the "View setup report" option. We keep exactly one prior
  // report — not a growing timestamped pile — because the project root
  // shouldn't carry an audit trail. (PR 316.)
  archiveSetupReportFile(session.installDir);

  // Helper bound to this run's session. The fallback never overwrites
  // an agent-authored report (see writeFallbackReportIfMissing's
  // existsSync check), so it's safe to invoke from any teardown path.
  const tryWriteFallback = (): void => {
    writeFallbackReportIfMissing({
      installDir: session.installDir,
      integration: session.integration,
      dashboardUrl: session.checklistDashboardUrl,
      workspaceName: session.selectedProjectName,
      envName: session.selectedEnvName,
    });
  };

  // Wire BOTH report-recovery helpers into every teardown path:
  //
  //   1. restoreSetupReportIfMissing — if the run never reaches the
  //      conclude phase, restore the archived prior report so the user
  //      gets back what they had before this run touched anything.
  //   2. writeFallbackReportIfMissing — if there was no prior report
  //      AND the agent never wrote one, synthesize a minimal report so
  //      the outro always has something to surface.
  //
  // ORDERING INVARIANT: restore MUST run before fallback. Both helpers
  // existsSync-gate the canonical path, so if fallback fired first it
  // would land a stub at canonical, restore would then see
  // canonical-exists and bail, and the user's prior real report would
  // stay permanently buried in `.previous.md`. Restore goes through
  // `registerPriorityCleanup` (unshifts onto the cleanup queue) so it
  // ALWAYS runs before any code that may write a fresh canonical
  // report, regardless of registration order.
  //
  // Registered as cleanups so wizardAbort() triggers them before
  // process.exit. The success-path re-fires below catch the two failure
  // modes that bypass wizardAbort (non-throwing return false, raw
  // throw).
  const { registerCleanup, registerPriorityCleanup } = await import(
    '../utils/wizard-abort.js'
  );
  registerPriorityCleanup(() =>
    restoreSetupReportIfMissing(session.installDir),
  );
  registerCleanup(tryWriteFallback);

  // Cleanup runs ONLY on the success path. Cancel / error / Ctrl+C all
  // preserve the wizard's working artifacts (`.amplitude-events.json`,
  // installed integration skills) so a re-run can pick up where the user
  // left off without re-confirming the event plan or re-downloading
  // skills. The gitignore (`ensureWizardArtifactsIgnored` above) keeps
  // those files out of source control regardless, so leaving them on
  // disk is harmless.
  //
  // Background: #261 originally wired cleanup through both `try/finally`
  // and `registerCleanup` so it fired on every exit. That broke
  // resumability — every Ctrl+C / transient error / cancel forced the
  // user to re-confirm their entire instrumentation plan from scratch.
  // The gitignore made the cleanup redundant for its stated purpose
  // (preventing `git add .` pollution).
  let success = false;
  try {
    success = await runAgentWizardBody(
      config,
      session,
      getAdditionalFeatureQueue,
      featureProgress,
    );
  } finally {
    // Cover the two failure paths that bypass wizardAbort's cleanup hook:
    //   - body returns false  (non-throwing early return, e.g. version check)
    //   - body throws         (uncaught exception propagates to caller)
    // Run restore first (recovers the archived prior report), then
    // fallback (synthesizes a minimal report only if neither agent nor
    // restore produced one). Both helpers existsSync-gate the canonical
    // path, so they're idempotent if wizardAbort already fired them.
    if (!success) {
      restoreSetupReportIfMissing(session.installDir);
      tryWriteFallback();
    }
  }
  // Cleanup runs only when the body explicitly signals success. Other
  // exit paths preserve artifacts:
  //   - body returns false  → non-success early return (e.g. version
  //     check failure surfaced via getUI().cancel, which does NOT exit
  //     the process). Skip cleanup so the user can re-run after
  //     upgrading without re-downloading the integration skill.
  //   - body throws         → propagates naturally; cleanup is skipped.
  //   - wizardAbort path    → calls process.exit(); this line is never
  //     reached, integration skills + events file stay on disk.
  if (success) {
    // Safety net for the rare case where the agent reaches a
    // successful conclusion without writing the report. The fallback
    // never overwrites an agent-authored report.
    tryWriteFallback();

    cleanupWizardArtifacts(session.installDir, { onSuccess: true });
  }
}

/**
 * Internal: the body of `runAgentWizard`, extracted so the public entry
 * point can run `cleanupWizardArtifacts({ onSuccess: true })` only on a
 * successful run. Returns `true` on a successful completion, `false` on
 * non-throwing early-exit paths (e.g. version-check failure where we
 * surface a cancel UI but don't throw or exit). Uncaught exceptions
 * propagate without running cleanup, preserving resumability on
 * cancel/error.
 */
async function runAgentWizardBody(
  config: FrameworkConfig,
  session: WizardSession,
  getAdditionalFeatureQueue?: () => readonly AdditionalFeature[],
  featureProgress?: {
    onFeatureStart?: (feature: AdditionalFeature) => void;
    onFeatureComplete?: (feature: AdditionalFeature) => void;
  },
): Promise<boolean> {
  // Version check
  if (
    config.detection.getInstalledVersion ||
    config.detection.getVersionCheckInfo
  ) {
    const versionCheckInfo = await getVersionCheckInfo(
      config.detection,
      sessionToOptions(session),
    );
    logToFile(`[runAgentWizard] detected version: ${versionCheckInfo.version}`);
    const versionWarning = getVersionWarning(versionCheckInfo, {
      coerceVersion: true,
    });
    if (versionWarning) {
      logToFile(`[runAgentWizard] ${versionWarning}`);
      const docsUrl =
        config.metadata.unsupportedVersionDocsUrl ?? config.metadata.docsUrl;
      logToFile(
        `[runAgentWizard] directing user to manual setup guide: ${docsUrl}`,
      );
      const minimumVersion =
        versionCheckInfo.minimumVersion ?? config.detection.minimumVersion;
      const packageDisplayName =
        versionCheckInfo.packageDisplayName ?? config.metadata.name;
      const version = versionCheckInfo.version ?? 'unknown';
      // Route through wizardAbort so the TUI Outro is shown, awaited,
      // *and* the process actually exits afterward. A previous version
      // called getUI().cancel() then `return false`, which left the
      // Ink event loop running indefinitely after the user dismissed
      // the outro because nothing called process.exit on this path.
      // wizardAbort handles cancel + analytics shutdown + exit as a
      // single atomic sequence; cancelOptions.docsUrl forwards the
      // manual-setup link into the Outro for recovery.
      await wizardAbort({
        message: `The wizard requires ${packageDisplayName} ${minimumVersion} or later, but found version ${version}. Upgrade your ${packageDisplayName} version to use the wizard, or follow the manual setup guide.`,
        exitCode: ExitCode.GENERAL_ERROR,
        cancelOptions: { docsUrl },
      });
      // Unreachable — wizardAbort returns Promise<never>. The earlier
      // `return false` documented "skip success-path cleanup so the
      // integration skill stays on disk for a clean re-run after the
      // user upgrades" — that's still preserved because process.exit
      // fires before any further work in this function runs.
      return false;
    }
  }

  // Setup phase — informational only, no prompts
  // Beta notice, pre-run notice, and welcome label are all derivable
  // from session.frameworkConfig — IntroScreen reads them directly.
  //
  // The wizard used to interrupt here with a SettingsOverrideScreen if
  // `.claude/settings.json` declared `ANTHROPIC_BASE_URL` or
  // `ANTHROPIC_AUTH_TOKEN` (e.g. for LiteLLM, corporate proxy, Claude
  // Pro/Max OAuth) — and offered to back the file up so the SDK wouldn't
  // load it. That was destructive (any non-graceful exit could lose the
  // file) and hostile to the typical Claude Code user. We now scope our
  // gateway env to `.claude/settings.local.json` instead, which the SDK
  // loads at higher precedence than the project file. The user's
  // checked-in settings.json is never touched. See
  // `claude-settings-scope.ts` and `agent-interface.ts:applyScopedSettings`.

  // Disclosure text is static — IntroScreen renders it directly.

  const typeScriptDetected = isUsingTypeScript({
    installDir: session.installDir,
  });
  session.typescript = typeScriptDetected;

  // Framework detection and version
  const usesPackageJson = config.detection.usesPackageJson !== false;
  let packageJson: PackageDotJson | null;
  let frameworkVersion: string | undefined;

  if (usesPackageJson) {
    packageJson = await tryGetPackageJson({ installDir: session.installDir });
    if (packageJson) {
      frameworkVersion = config.detection.getVersion(packageJson);
      // Log warning if package not found, but continue (agent handles it).
      // Uses getVersion() rather than checking packageName directly so
      // frameworks that match multiple packages (e.g. React Router +
      // TanStack) don't trigger false "not installed" warnings.
      if (!frameworkVersion) {
        getUI().log.warn(
          `${config.detection.packageDisplayName} does not seem to be installed. Continuing anyway — the agent will handle it.`,
        );
      }
    } else {
      getUI().log.warn(
        'Could not find package.json. Continuing anyway — the agent will handle it.',
      );
    }
  } else {
    frameworkVersion = config.detection.getVersion(null);
  }

  // Set analytics tags for framework version
  if (frameworkVersion && config.detection.getVersionBucket) {
    const versionBucket = config.detection.getVersionBucket(frameworkVersion);
    analytics.setSessionProperty(
      `${config.metadata.integration}-version`,
      versionBucket,
    );
  }

  analytics.wizardCapture('agent started', {
    integration: config.metadata.integration,
  });

  // Credentials are pre-set by bin.ts (TUI mode) via the AuthScreen SUSI flow.
  // Only fall back to getOrAskForProjectData for CI mode or non-TUI fallback.
  if (!session.credentials) {
    const authResult = await getOrAskForProjectData({
      signup: session.signup,
      ci: session.ci,
      apiKey: session.apiKey,
      appId: session.appId,
      installDir: session.installDir,
    });

    session.credentials = {
      accessToken: authResult.accessToken,
      projectApiKey: authResult.projectApiKey,
      host: authResult.host,
      appId: authResult.appId,
    };
    getUI().setCredentials({
      ...session.credentials,
      orgId: session.selectedOrgId,
      orgName: session.selectedOrgName,
      projectId: session.selectedProjectId,
      projectName: session.selectedProjectName,
      envName: session.selectedEnvName,
    });
    getUI().setRegion(authResult.cloudRegion);
    getUI().setProjectHasData(false);
  }

  const {
    accessToken: rawAccessToken,
    projectApiKey,
    host,
    appId,
  } = session.credentials;
  // The TUI's AuthScreen may have stored the id_token instead of the
  // OAuth access token (the field names were swapped historically).
  // Always prefer the real OAuth access token from ~/.ampli.json for Hydra auth.
  let accessToken = rawAccessToken;
  try {
    const { getStoredToken, getStoredUser, storeToken } = await import(
      '../utils/ampli-settings.js'
    );
    const { refreshAccessToken } = await import('../utils/oauth.js');
    const user = getStoredUser();
    const stored = getStoredToken(user?.id, user?.zone);
    if (stored?.accessToken) {
      accessToken = stored.accessToken;
      // Silently refresh if the access token has expired but the refresh window is still valid.
      // CRITICAL: pass the user's zone — without it `refreshAccessToken` defaults
      // to the US OAuth host (auth.amplitude.com) and EU users' refresh tokens
      // get rejected. The catch below then logs "auth refresh failed" and the
      // wizard proceeds with the (already-expired) access token; every
      // subsequent fetchAmplitudeUser / Amplitude MCP call surfaces as
      // "Authentication failed while trying to fetch Amplitude user data" —
      // both during the agent run and afterwards in DataIngestionCheckScreen.
      if (user && new Date() > new Date(stored.expiresAt)) {
        const refreshStartedAt = Date.now();
        try {
          const refreshed = await refreshAccessToken(
            stored.refreshToken,
            user.zone,
          );
          storeToken(user, {
            accessToken: refreshed.accessToken,
            idToken: refreshed.idToken,
            refreshToken: refreshed.refreshToken,
            expiresAt: refreshed.expiresAt,
          });
          accessToken = refreshed.accessToken;
          analytics.wizardCapture('auth refreshed silently', {
            'duration ms': Date.now() - refreshStartedAt,
          });
        } catch (err) {
          // Refresh failed — proceed with the existing token; auth error will
          // surface during the run. Instrument the reason so we can distinguish
          // expired refresh tokens from network failures in dashboards.
          analytics.wizardCapture('auth refresh failed', {
            reason: err instanceof Error ? err.message : 'unknown',
            'duration ms': Date.now() - refreshStartedAt,
          });
        }
      }
    }
  } catch {
    // Fall back to whatever the TUI provided
  }
  // Derive cloudRegion from session via the centralized resolver.
  // readDisk: true — the agent runner may be entered via paths (classic UI,
  // resumed sessions) where the RegionSelect invariant isn't guaranteed.
  const cloudRegion: import('../utils/types.js').CloudRegion = resolveZone(
    session,
    DEFAULT_AMPLITUDE_ZONE,
    { readDisk: true },
  );

  // Framework context was already gathered by SetupScreen + detection
  const frameworkContext = session.frameworkContext;

  // Set analytics tags from framework context
  const contextTags = config.analytics.getTags(frameworkContext);
  Object.entries(contextTags).forEach(([key, value]) => {
    analytics.setSessionProperty(key, value);
  });

  // Skip the Amplitude MCP when the framework provides its own prompt (no MCP needed)
  // OR when there is no valid access token (MCP would fail auth and the agent would get stuck).
  const skipAmplitudeMcp =
    config.prompts.buildPrompt !== undefined || !accessToken;

  // Pre-stage all bundled skills the agent will need into the user's
  // .claude/skills/ directory. The taxonomy / instrumentation / dashboard
  // skills are constants; the integration skill is resolved per framework
  // (with a sensible default fallback). When a skill is pre-staged we drop
  // the corresponding load_skill_menu / install_skill steps from the prompt.
  const { preStageSkills, bundledSkillExists } = await import(
    './wizard-tools.js'
  );
  const integrationSkillId = config.metadata.getIntegrationSkillId
    ? config.metadata.getIntegrationSkillId(frameworkContext)
    : (() => {
        const fallback = `integration-${config.metadata.integration}`;
        return bundledSkillExists(fallback) ? fallback : null;
      })();
  const { integrationStaged } = preStageSkills(
    session.installDir,
    integrationSkillId,
  );

  const integrationPrompt =
    buildIntegrationPrompt(
      config,
      {
        frameworkVersion: frameworkVersion || 'latest',
        typescript: typeScriptDetected,
        projectApiKey,
        host,
        appId,
        cloudRegion,
      },
      frameworkContext,
      skipAmplitudeMcp,
      integrationStaged ? integrationSkillId : null,
    ) + buildInlineFeatureSection(session.additionalFeatureQueue);

  // Initialize and run agent
  const spinner = getUI().spinner();

  // Evaluate all feature flags at the start of the run so they can be sent to the LLM gateway
  const wizardFlags = await analytics.getAllFlagsForWizard();
  const wizardMetadata = buildWizardMetadata(wizardFlags);

  // Determine MCP URL: CLI flag > env var > production default
  const mcpUrl = session.localMcp
    ? 'http://localhost:8787/mcp'
    : process.env.MCP_URL || 'https://mcp.amplitude.com/mcp';

  // Skills URL: derived from the same host as the LLM proxy.
  // Always tries remote first; falls back to bundled if fetch fails.
  // Override with SKILLS_URL env var for testing.
  const skillsBaseUrl =
    process.env.SKILLS_URL || getLlmGatewayUrlFromHost(host) + '/skills';

  // The previous restore-on-outro hook was paired with the destructive
  // `backupAndFixClaudeSettings` flow. The new scoping (writing our env
  // into `.claude/settings.local.json`) registers its own restore via
  // `registerCleanup` from inside `applyScopedSettings`, so the file
  // returns to its pre-wizard state on every exit path — no separate
  // outro hook needed.
  getUI().startRun();

  const agent = await getAgent(
    {
      workingDirectory: session.installDir,
      amplitudeMcpUrl: mcpUrl,
      amplitudeApiKey: projectApiKey,
      amplitudeBearerToken: accessToken,
      amplitudeApiHost: host,
      additionalMcpServers: config.metadata.additionalMcpServers,
      detectPackageManager: config.detection.detectPackageManager,
      wizardFlags,
      wizardMetadata,
      skipAmplitudeMcp,
      skillsBaseUrl,
      agentSessionId: session.agentSessionId,
      targetsBrowser: config.metadata.targetsBrowser,
    },
    sessionToOptions(session),
  );

  // Always run observability middleware for structured logging + Sentry breadcrumbs.
  // Retry middleware surfaces transient gateway retries to the UI.
  // Benchmark middleware (token/cost tracking) is opt-in via --benchmark.
  const retryMiddleware = createRetryMiddleware((state) =>
    getUI().setRetryState(state),
  );
  const middleware = session.benchmark
    ? createBenchmarkPipeline(spinner, sessionToOptions(session), undefined, {
        extraMiddlewares: [retryMiddleware],
      })
    : new MiddlewarePipeline([
        createObservabilityMiddleware(),
        retryMiddleware,
      ]);

  const agentResult = await runAgent(
    agent,
    integrationPrompt,
    sessionToOptions(session),
    spinner,
    {
      estimatedDurationMinutes: config.ui.estimatedDurationMinutes,
      spinnerMessage: SPINNER_MESSAGE,
      successMessage: config.ui.successMessage,
      errorMessage: 'Integration failed',
      additionalFeatureQueue:
        getAdditionalFeatureQueue ?? (() => session.additionalFeatureQueue),
      onFeatureStart: featureProgress?.onFeatureStart,
      onFeatureComplete: featureProgress?.onFeatureComplete,
      // Fires just before the SDK summarizes context. Refresh the on-disk
      // checkpoint so a compaction crash leaves the user with a resumable
      // state, and capture an analytics breadcrumb for cost/quality analysis.
      onPreCompact: ({ trigger }) => {
        try {
          saveCheckpoint(session);
        } catch (err) {
          logToFile('PreCompact: saveCheckpoint failed', err);
        }
        analytics.wizardCapture('agent compaction triggered', {
          trigger,
          integration: session.integration ?? null,
          'detected framework': session.detectedFrameworkLabel ?? null,
        });
      },
    },
    middleware,
  );

  // Handle error cases detected in agent output
  if (agentResult.error === AgentErrorType.AUTH_ERROR) {
    captureWizardError(
      'Agent Authentication',
      'Session expired or invalid during agent run',
      'agent-runner',
      { integration: config.metadata.integration },
    );
    const authMessage = `Authentication failed\n\nYour Amplitude session has expired. Please run the wizard again to log in.`;
    session.credentials = null;
    session.outroData = {
      kind: OutroKind.Error,
      message: authMessage,
      promptLogin: true,
      canRestart: true,
    };
    await wizardAbort({
      message: authMessage,
      error: new WizardError('Authentication failed during agent run', {
        integration: config.metadata.integration,
        'error type': AgentErrorType.AUTH_ERROR,
      }),
      exitCode: ExitCode.AUTH_REQUIRED,
    });
  }

  if (
    agentResult.error === AgentErrorType.MCP_MISSING ||
    agentResult.error === AgentErrorType.RESOURCE_MISSING
  ) {
    // Soft-error path: if the agent has already instrumented events
    // (or completed everything including the dashboard), an MCP /
    // resource failure here is on a tail-end call — most commonly the
    // dashboard creation step at the end of the conclude phase. The
    // SDK is installed, events are instrumented, code is written.
    // Hard-aborting would throw away all that work and show the user a
    // "Setup cancelled" outro with no recap of what succeeded.
    //
    // Real-world example: ✓ Welcome ✓ Auth ✓ Setup ✓ Verify ● Done —
    // every step green-checked, but the wizard surfaced
    // "Setup cancelled" with the detail "Amplitude MCP not connected
    // — dashboard could not be created automatically. Visit
    // app.amplitude.com to build it manually using the chart plan
    // below." The agent itself reported the failure as partial and
    // suggested a recovery path; the wizard ignored that nuance.
    //
    // The MCP_MISSING signal can come from EITHER the in-process
    // `wizard-tools` MCP (skill loading, env vars) OR the remote
    // `amplitude-wizard` MCP (mcp.amplitude.com — event plans,
    // dashboards). The agent-reported detail is preserved on the
    // WizardError payload for Sentry / `agent error detail` analytics
    // so we can disambiguate which server failed.
    const errorType = agentResult.error;
    const detail = agentResult.message ?? null;
    const dashboardComplete = agentArtifactsLookComplete(session);
    const eventsInstrumented = agentEventsInstrumented(session);

    if (dashboardComplete || eventsInstrumented) {
      logToFile(
        `[agent-runner] Soft ${errorType} after agent did meaningful work (dashboard=${dashboardComplete}, events=${eventsInstrumented}): ${
          detail ?? '(no detail)'
        }. Continuing to MCP / outro.`,
      );
      analytics.wizardCapture('agent soft error', {
        integration: config.metadata.integration,
        'error type': errorType,
        'dashboard complete': dashboardComplete,
        'events instrumented': eventsInstrumented,
        'agent error detail': detail,
      });
      // Surface a plain-English warning so the user knows what's
      // recoverable. Without this they'd see a normal success outro
      // with no hint that the dashboard step actually failed.
      // Copy stays jargon-free — same standard as PR #336.
      const what = dashboardComplete
        ? 'a late tooling step'
        : 'the dashboard creation step';
      getUI().pushStatus(
        `Note: ${what} couldn't reach Amplitude's setup service — your SDK + events are instrumented. ${
          dashboardComplete
            ? ''
            : 'Build the dashboard manually at https://app.amplitude.com using the event names in your code. '
        }Detail: ${detail || errorType}`,
      );
      // Fall through to env-var upload, MCP install, Slack, Outro —
      // they don't depend on agentResult.error being null.
    } else {
      // Hard-error path: agent didn't get far enough to leave the
      // project usable. Could be the in-process wizard-tools MCP
      // (skill loading) failing right at startup. Abort with the
      // jargon-free copy from PR #336.
      const isMcp = errorType === AgentErrorType.MCP_MISSING;
      await wizardAbort({
        message: isMcp
          ? `Couldn't reach Amplitude's setup service — this looks like a network or service issue.\n\nTry again in a moment, or set up ${config.metadata.name} manually:\n${config.metadata.docsUrl}`
          : `Couldn't load setup instructions for ${config.metadata.name} — this may be a temporary service issue or a version mismatch.\n\nTry again in a moment, or set up ${config.metadata.name} manually:\n${config.metadata.docsUrl}`,
        error: new WizardError(
          isMcp
            ? 'Agent could not access Amplitude MCP server'
            : 'Agent could not access setup resource',
          {
            integration: config.metadata.integration,
            'error type': errorType,
            'agent error detail': detail,
          },
        ),
        exitCode: ExitCode.AGENT_FAILED,
      });
    }
  }

  if (agentResult.error === AgentErrorType.GATEWAY_DOWN) {
    captureWizardError(
      'Agent API',
      agentResult.message ?? 'LLM gateway unavailable',
      'agent-runner',
      {
        integration: config.metadata.integration,
        'error type': agentResult.error,
      },
    );

    const usingDirectKey = !!process.env.ANTHROPIC_API_KEY;
    await wizardAbort({
      message: `Amplitude LLM gateway unavailable\n\nEvery retry attempt failed with the same upstream error (${
        agentResult.message || 'API Error: 400 terminated'
      }). This is an issue with the Amplitude LLM gateway, not your project.\n\n${buildGatewayBypassHint()}\n\nIf this persists, please report it (with the log file at ${getLogFilePath()}) to: ${SUPPORT_EMAIL}`,
      error: new WizardError(
        `LLM gateway unavailable: ${agentResult.message ?? 'unknown'}`,
        {
          integration: config.metadata.integration,
          'error type': agentResult.error,
          'using direct key': usingDirectKey,
          'agent error detail': agentResult.message ?? null,
        },
      ),
      exitCode: ExitCode.NETWORK_ERROR,
    });
  }

  if (
    agentResult.error === AgentErrorType.RATE_LIMIT ||
    agentResult.error === AgentErrorType.API_ERROR
  ) {
    const rawMessage = agentResult.message ?? '';

    // Soft-error path: if the agent's actual work artifacts exist on
    // the session (dashboard URL set), the API failure was on a
    // tail-end call (often the last token flush, an observability
    // ping, or a hook closing the stream after the agent already
    // wrote the setup report and created the dashboard). Hard-aborting
    // here would skip MCP / Slack / Outro and exit with a network
    // error code, even though the user's project is in a fully-set-up
    // state. Continue past this branch so the user gets their
    // dashboard link, the MCP install offer, and a normal Outro.
    if (agentArtifactsLookComplete(session)) {
      const errorSubtype = classifyApiErrorSubtype({
        errorType: agentResult.error,
        message: rawMessage,
      });
      logToFile(
        `[agent-runner] Soft API error after work completed (${errorSubtype}): ${rawMessage}. Continuing to MCP / outro.`,
      );
      analytics.wizardCapture('agent soft error', {
        integration: config.metadata.integration,
        'error type': agentResult.error,
        'error subtype': errorSubtype,
      });
      // Surface a non-fatal warning in the status ticker so the user
      // sees something happened on the way out, but don't abort.
      getUI().pushStatus(
        `Note: a late API call failed (${
          rawMessage || agentResult.error
        }) but your project's setup is complete — continuing.`,
      );
      // Fall through to the post-agent steps (env upload, MCP, Slack,
      // DataIngestion, Outro). They don't depend on agentResult.error
      // being null, just on getting past this if/else.
    } else {
      // Hard-error path: artifacts missing, so the agent didn't get
      // far enough to leave the project in a usable state. Abort.
      await abortOnApiError(agentResult.error, rawMessage, config);
    }
  }

  // Build environment variables from OAuth credentials
  const envVars = config.environment.getEnvVars(projectApiKey, host);

  // Upload environment variables to hosting providers (auto-accept)
  let uploadedEnvVars: string[] = [];
  if (config.environment.uploadToHosting) {
    const { uploadEnvironmentVariablesStep } = await import(
      '../steps/index.js'
    );
    uploadedEnvVars = await uploadEnvironmentVariablesStep(envVars, {
      integration: config.metadata.integration,
      session,
    });
  }

  // Post-install restart reminder — the single most common failure mode is
  // a user whose dev server was already running when we wrote env vars and
  // who doesn't know to restart it for the new values to load. Emit this
  // once for human-operator modes (interactive TUI + CI-with-oversight),
  // and only when env vars were actually written (some frameworks set
  // getEnvVars to {} and manage config differently).
  // Suppressed for --agent/NDJSON mode: agent orchestrators run against
  // fresh processes or test apps, not a human-managed dev server.
  if (!session.agent && Object.keys(envVars).length > 0) {
    getUI().pushStatus(
      `Your Amplitude env vars are set. If your dev server or build was already running, restart it (with whatever command you started it with) so the new values load — then click around your app and we'll wait for events.`,
    );
  }

  // Commit the instrumented event plan to the Amplitude tracking plan as
  // planned events so the names show up in the Data tab immediately — even
  // before any track() call fires in the user's app.
  const plannedEventsSummary = await commitPlannedEventsStep(
    agentResult.plannedEvents ?? [],
    accessToken,
    appId,
    session,
    cloudRegion,
  );

  // Post-agent dashboard creation — bounded by its own timeout so a slow
  // Amplitude MCP response can't hang the whole run. Gracefully degrades:
  // agent success is not affected by dashboard-step failure.
  try {
    const { createDashboardStep } = await import(
      '../steps/create-dashboard.js'
    );
    await createDashboardStep({
      session,
      accessToken,
      integration: config.metadata.integration,
    });
  } catch (err) {
    logToFile(
      `[agent-runner] createDashboardStep threw: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // MCP installation is handled by McpScreen — no prompt here

  // Data ingestion check — agent mode only (not CI).
  // Poll via MCP until events arrive, then emit a structured result event.
  if (session.agent) {
    await pollForDataIngestion(session, accessToken, cloudRegion);
  }

  // Build outro data and store it for OutroScreen
  const continueUrl = session.signup
    ? OUTBOUND_URLS.products(cloudRegion)
    : undefined;

  const changes = [
    ...config.ui.getOutroChanges(frameworkContext),
    Object.keys(envVars).length > 0
      ? `Added environment variables to .env file`
      : '',
    uploadedEnvVars.length > 0
      ? `Uploaded environment variables to your hosting provider`
      : '',
    plannedEventsSummary,
  ].filter(Boolean);

  session.outroData = {
    kind: OutroKind.Success,
    changes,
    docsUrl: config.metadata.docsUrl,
    continueUrl,
  };

  // Wizard-artifact cleanup happens in `runAgentWizard` after this
  // function returns `true`. Cancel/error paths return `false` (or
  // throw / call wizardAbort) so artifacts are preserved for a clean
  // re-run.

  getUI().outro(`Successfully installed Amplitude!`);

  await analytics.shutdown('success');
  return true;
}

/**
 * Poll the Amplitude MCP server for event ingestion in agent mode.
 *
 * Emits structured NDJSON events via the AgentUI:
 *   - `status` events every poll cycle while waiting
 *   - `result` event when events are detected (includes event names)
 *   - `log` warning if the timeout is reached without detecting events
 *
 * Skipped silently if no project ID can be resolved (e.g. --api-key flow).
 *
 * @param session    - wizard session (must have session.agent === true)
 * @param accessToken - OAuth access token for MCP Bearer auth
 * @param cloudRegion - us | eu, used to resolve project ID lazily if needed
 */
async function pollForDataIngestion(
  session: WizardSession,
  accessToken: string,
  cloudRegion: string,
): Promise<void> {
  const { fetchHasAnyEventsMcp, fetchAmplitudeUser } = await import(
    '../lib/api.js'
  );
  const { logToFile } = await import('../utils/debug.js');

  const POLL_INTERVAL_MS = 30_000;
  // Allow override for testing; default 30 minutes.
  const MAX_WAIT_MS =
    Number(process.env.DATA_INGESTION_TIMEOUT_MS) || 30 * 60 * 1000;

  // Resolve the numeric Amplitude app ID.
  // It is set by resolveEnvironmentSelection for the environment-picker path,
  // and by the fire-and-forget in bin.ts for the TUI path.
  // If still missing, try a single fetchAmplitudeUser call.
  let appId = session.selectedAppId ?? null;
  if (!appId) {
    try {
      const userInfo = await fetchAmplitudeUser(
        accessToken,
        cloudRegion as 'us' | 'eu',
      );
      const org = session.selectedOrgId
        ? userInfo.orgs.find((o) => o.id === session.selectedOrgId)
        : userInfo.orgs[0];
      const project =
        org && session.selectedProjectId
          ? org.projects.find((p) => p.id === session.selectedProjectId)
          : org?.projects[0];
      appId =
        project?.environments
          ?.slice()
          .sort((a, b) => a.rank - b.rank)
          .find((e) => e.app?.id)?.app?.id ?? null;
      if (appId) session.selectedAppId = appId;
    } catch (err) {
      logToFile(
        `[pollForDataIngestion] could not resolve appId: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  if (!appId) {
    logToFile('[pollForDataIngestion] no appId — skipping ingestion check');
    return;
  }

  const ui = getUI();
  ui.pushStatus('Waiting for events — run your app and trigger some actions');

  const deadline = Date.now() + MAX_WAIT_MS;
  let pollCount = 0;
  // Bound each individual MCP poll. Without this, a single hung fetch would
  // never resolve and the poll loop would advance only once the surrounding
  // process tore down, leaving the request stuck in the background.
  const PER_POLL_TIMEOUT_MS = 25_000;
  // Bail out of the poll loop the moment the wizard is cancelled
  // (Ctrl+C / SIGINT → graceful-exit → abortWizard). Without this the
  // 30s setTimeout below would block the 2s grace window for up to 28s,
  // so the user would either see a hung exit or the kernel would
  // SIGKILL the process before the poll resolved.
  const wizardSignal = getWizardAbortSignal();

  while (Date.now() < deadline) {
    if (wizardSignal.aborted) {
      logToFile('[pollForDataIngestion] aborted via wizard signal');
      return;
    }
    pollCount++;
    logToFile(`[pollForDataIngestion] poll #${pollCount} appId=${appId}`);

    // Per-poll AbortController — wired through to fetchHasAnyEventsMcp so
    // the in-flight HTTP request unwinds when the poll deadline fires
    // (rather than running to completion in the background).
    const pollController = new AbortController();
    const pollTimer = setTimeout(
      () => pollController.abort(),
      PER_POLL_TIMEOUT_MS,
    );
    try {
      // Pass the per-poll signal so the explicit per-poll timeout aborts
      // the in-flight HTTP request. callAmplitudeMcp also defaults to the
      // wizard signal when no explicit signal is provided; here we use the
      // per-poll signal and rely on the loop-level wizardSignal checks
      // (above and in the inter-poll wait below) to honor Ctrl+C.
      const result = await fetchHasAnyEventsMcp(
        accessToken,
        appId,
        pollController.signal,
      );
      if (result.hasEvents) {
        logToFile(
          `[pollForDataIngestion] events detected: ${result.activeEventNames.join(
            ', ',
          )}`,
        );
        // Emit a structured result event so callers can act on it.
        ui.setEventIngestionDetected(result.activeEventNames);
        ui.log.success(
          `Events detected: ${
            result.activeEventNames.length > 0
              ? result.activeEventNames.join(', ')
              : '(events flowing)'
          }`,
        );
        session.dataIngestionConfirmed = true;
        return;
      }
    } catch (err) {
      logToFile(
        `[pollForDataIngestion] poll error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      // Always clear the per-poll timer so a fast success/failure doesn't
      // leak ~30 minutes' worth of stranded timers across the loop.
      clearTimeout(pollTimer);
    }

    // Wait before the next poll, but bail early if deadline passed
    // OR if the wizard is cancelled. Race the timer with the abort
    // signal so a Ctrl+C unblocks immediately instead of waiting up
    // to POLL_INTERVAL_MS for the next iteration to see the flag.
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    if (wizardSignal.aborted) {
      logToFile('[pollForDataIngestion] aborted via wizard signal');
      return;
    }
    await new Promise<void>((resolve) => {
      const waitMs = Math.min(POLL_INTERVAL_MS, remaining);
      const timer = setTimeout(() => {
        wizardSignal.removeEventListener('abort', onAbort);
        resolve();
      }, waitMs);
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve();
      };
      wizardSignal.addEventListener('abort', onAbort, { once: true });
    });
  }

  if (wizardSignal.aborted) {
    logToFile('[pollForDataIngestion] aborted via wizard signal');
    return;
  }

  logToFile('[pollForDataIngestion] timeout reached without detecting events');
  ui.log.warn(
    'No events detected within the timeout window. ' +
      'Run your app to send events, then check your Amplitude dashboard.',
  );
}

/**
 * Append per-feature instructions for any inline features the user opted into.
 * Returns an empty string when no inline features are queued.
 */
function buildInlineFeatureSection(
  queue: readonly AdditionalFeature[],
): string {
  const inline = queue.filter((f) => INLINE_FEATURES.has(f));
  if (inline.length === 0) return '';

  const items = inline
    .map(
      (f) =>
        `### ${ADDITIONAL_FEATURE_LABELS[f]}\n${ADDITIONAL_FEATURE_PROMPTS[f]}`,
    )
    .join('\n\n');

  return `

ADDITIONAL FEATURES (configure as part of SDK initialization):

The user has opted in to additional Amplitude features. Configure these as part of the SDK initialization step — in the same initAll() call where applicable — rather than as a separate task. Update the relevant TodoWrite task name to reflect what you're doing.

${items}
`;
}

/**
 * Build the integration prompt for the agent.
 *
 * `preStagedIntegrationSkillId` is the integration skill that the runner
 * already copied into `.claude/skills/<id>/`. When non-null the prompt skips
 * the load_skill_menu / install_skill discovery loop; otherwise the agent
 * falls back to discovering an integration skill at runtime.
 *
 * Taxonomy + instrumentation + dashboard skills are always pre-staged when
 * bundled, so the prompt loads them by ID without menu/install steps.
 */
function buildIntegrationPrompt(
  config: FrameworkConfig,
  context: {
    frameworkVersion: string;
    typescript: boolean;
    projectApiKey: string;
    host: string;
    appId: number;
    cloudRegion: 'us' | 'eu';
  },
  frameworkContext: Record<string, unknown>,
  skipAmplitudeMcp: boolean,
  preStagedIntegrationSkillId: string | null,
): string {
  if (config.prompts.buildPrompt) {
    return config.prompts.buildPrompt({
      ...context,
      frameworkContext,
    });
  }

  // No valid auth token → MCP will be skipped. Fall back to the generic direct prompt
  // so the agent has actionable instructions instead of getting stuck on ListMcpResourcesTool.
  if (skipAmplitudeMcp) {
    const genericBuildPrompt = GENERIC_AGENT_CONFIG.prompts.buildPrompt;
    if (!genericBuildPrompt) {
      throw new Error('Generic agent config is missing buildPrompt');
    }
    return genericBuildPrompt({ ...context, frameworkContext });
  }

  // Region-aware app URL — the dashboard / chart links the agent surfaces in
  // the setup report MUST use the user's data-center hostname. Without this,
  // EU users got dashboard URLs at `app.amplitude.com/...` (US) because the
  // skill examples are written against US hosts and the agent had nothing
  // telling it the run was EU.
  const appHost =
    context.cloudRegion === 'eu'
      ? 'https://app.eu.amplitude.com'
      : 'https://app.amplitude.com';

  // The wizard's appId is 0 when the env picker couldn't match an app to the
  // chosen API key (manual API-key entry, or backend_fetch returning a key
  // that's not in the picker's environments). When that happens, the agent
  // should look up the canonical project for the API key via the Amplitude
  // MCP's `get_context` and use ITS `defaultAppId` — never browse the
  // `appsByCategory` list and pick a different project. Pre-PR the agent
  // routinely picked the wizard team's own dev project (802868) and created
  // dashboards there; the user's setup report linked to a project they
  // don't own.
  const appIdGuidance =
    context.appId === 0
      ? `- Amplitude App ID: not set by the wizard (0). When you call the Amplitude MCP, get the appId from \`get_context().defaultAppId\` — that's the project tied to the API key above. NEVER pick a different appId from \`appsByCategory\` or any other listing in the get_context response. Every chart / dashboard you create MUST belong to that exact project. If \`defaultAppId\` is missing or null, halt with report_status kind="error", code="RESOURCE_MISSING", detail="Could not resolve project from API key" — do not guess.`
      : `- Amplitude App ID (shown in Amplitude UI as "Project ID"): ${context.appId}. Every chart / dashboard you create MUST use this exact appId. Do NOT call \`get_context\` to pick a different one — the wizard already resolved it and the API key above belongs to this project.`;

  const additionalLines = config.prompts.getAdditionalContextLines
    ? config.prompts.getAdditionalContextLines(frameworkContext)
    : [];

  const additionalContext =
    additionalLines.length > 0
      ? '\n' + additionalLines.map((line) => `- ${line}`).join('\n')
      : '';

  // Integration-skill block: either reference the pre-staged skill directly,
  // or fall back to the legacy load_skill_menu / install_skill flow when the
  // runner couldn't pre-stage one (rare — typically TanStack Router and
  // similar variants without a deterministic resolver).
  const integrationSkillStep = preStagedIntegrationSkillId
    ? `STEP 1: Load \`.claude/skills/${preStagedIntegrationSkillId}/SKILL.md\` via the Skill tool. The wizard has already pre-staged this integration skill for ${config.metadata.name}; do NOT call load_skill_menu or install_skill for the integration category.`
    : `STEP 1: Call load_skill_menu (from the wizard-tools MCP server) with category "integration" to see available skills.
   If the tool fails, call report_status with kind="error", code="MCP_MISSING", detail="Could not load skill menu" and halt.
   Pick the skill that matches this project's framework, then call install_skill with that skill ID, then load \`.claude/skills/<skillId>/SKILL.md\` via the Skill tool.
   If no suitable integration skill is found, call report_status with kind="error", code="RESOURCE_MISSING", detail="Could not find a suitable skill for this project" and halt.`;

  return `You are setting up Amplitude analytics in this ${
    config.metadata.name
  } project. The wizard has pre-staged the skills you'll need into \`.claude/skills/\` — load them with the Skill tool by ID instead of calling load_skill_menu / install_skill.

Project context:
${appIdGuidance}
- Framework: ${config.metadata.name} ${context.frameworkVersion}
- TypeScript: ${context.typescript ? 'Yes' : 'No'}
- Amplitude public token: ${context.projectApiKey}
- Amplitude Host: ${context.host}
- Data region: ${context.cloudRegion.toUpperCase()} — every Amplitude UI link you write into the setup report (dashboard URL, chart URLs, project settings) MUST use \`${appHost}\` as the host. Do NOT use \`https://app.amplitude.com\` for an EU run, or vice versa; mismatched hosts redirect to the wrong data center and the user sees an empty project.
- Project type: ${config.prompts.projectTypeDetection}
- Package installation: ${
    config.prompts.packageInstallation ?? DEFAULT_PACKAGE_INSTALLATION
  }${additionalContext}

Instructions (follow these steps IN ORDER - do not skip or reorder):

${integrationSkillStep}

STEP 2: Follow the skill's workflow files in sequence. Look for numbered workflow files in the references (e.g., files with patterns like "1.0-", "1.1-", "1.2-"). Start with the first one and proceed through each step until completion. Each workflow file will tell you what to do and which file comes next. Never directly write Amplitude tokens directly to code files; always use environment variables.

STEP 3: Set up environment variables for Amplitude using the wizard-tools MCP server (this runs locally — secret values never leave the machine):
   - Use check_env_keys to see which keys already exist in the project's .env file (e.g. .env.local or .env).
   - Use set_env_values to create or update the Amplitude public token and host, using the appropriate environment variable naming convention for ${
     config.metadata.name
   }, which you'll find in example code. The tool will also ensure .gitignore coverage. Don't assume the presence of keys means the value is up to date. Write the correct value each time.
   - Reference these environment variables in the code files you create instead of hardcoding the public token and host.

STEP 4: Add event tracking to this project. The taxonomy and instrumentation skills are already pre-staged at \`.claude/skills/\` — load them by ID with the Skill tool. Do NOT call load_skill_menu or install_skill for these.
   - If you enabled Amplitude Autocapture in the SDK init code during integration (typical for web SDKs, not for Swift unless the plugin was added, and not applicable to backend SDKs), the events you propose to confirm_event_plan MUST exclude anything Autocapture already covers for this platform — no "Clicked", "Tapped", "Submitted", or "Viewed" events. If Autocapture is off or unsupported, propose events normally but still favor business-outcome and state-change events over raw interaction events.
   - Load \`.claude/skills/amplitude-quickstart-taxonomy-agent/SKILL.md\` and follow it when **naming events**, choosing **properties**, and scoping a **starter-kit taxonomy** (business-outcome events, property limits, funnel/linkage rules). Keep using this skill alongside instrumentation so names stay analysis-ready.
   - Load \`.claude/skills/add-analytics-instrumentation/SKILL.md\` and follow its workflow using the "File / Directory" input type: analyze the project's main source directory to discover user-facing features and surfaces that should be instrumented.
   - The skill will guide you through discovering candidate events, filtering to the most critical ones, and producing a concrete tracking plan with exact file locations and tracking code.
   - Implement the tracking calls for all priority-3 (critical) events identified by the skill.

STEP 5: Create the Amplitude dashboard. Load \`.claude/skills/amplitude-chart-dashboard-plan/SKILL.md\` via the Skill tool and follow it exactly. Do NOT call load_skill_menu or install_skill for this skill.

Important: Use the detect_package_manager tool (from the wizard-tools MCP server) to determine which package manager the project uses. Do not manually search for lockfiles or config files. Always install packages as a background task. Don't await completion; proceed with other work immediately after starting the installation. You must read a file immediately before attempting to write it, even if you have previously read it; failure to do so will cause a tool failure.


`;
}

/**
 * Push the agent's instrumented event plan into the Amplitude tracking plan as
 * planned events. Returns an outro-ready summary string (empty if nothing was
 * committed). Never throws — a failure here must not block the outro.
 *
 * Falls back to `session.selectedAppId` and finally a live fetchAmplitudeUser
 * lookup when `session.credentials.appId` is 0 (the env picker couldn't match
 * an app to the chosen API key).
 */
async function commitPlannedEventsStep(
  plannedEvents: Array<{ name: string; description: string }>,
  accessToken: string,
  credentialsAppId: number | null | undefined,
  session: WizardSession,
  cloudRegion: string,
): Promise<string> {
  if (!plannedEvents || plannedEvents.length === 0) {
    logToFile('[commitPlannedEventsStep] no planned events — skipping');
    return '';
  }

  let appId: string | number | null | undefined = credentialsAppId;
  if (!appId) appId = session.selectedAppId;
  if (!appId) {
    try {
      const { fetchAmplitudeUser } = await import('./api.js');
      const userInfo = await fetchAmplitudeUser(
        accessToken,
        cloudRegion as 'us' | 'eu',
      );
      const org = session.selectedOrgId
        ? userInfo.orgs.find((o) => o.id === session.selectedOrgId)
        : userInfo.orgs[0];
      const ws =
        org && session.selectedProjectId
          ? org.projects.find((w) => w.id === session.selectedProjectId)
          : org?.projects[0];
      appId =
        ws?.environments
          ?.slice()
          .sort((a, b) => a.rank - b.rank)
          .find((e) => e.app?.id)?.app?.id ?? null;
      if (appId) session.selectedAppId = String(appId);
    } catch (err) {
      logToFile(
        `[commitPlannedEventsStep] could not resolve appId: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  if (!appId) {
    logToFile('[commitPlannedEventsStep] no appId — skipping');
    return '';
  }

  try {
    const { commitPlannedEvents } = await import('./planned-events.js');
    logToFile(
      `[commitPlannedEventsStep] committing ${plannedEvents.length} planned events to appId=${appId}`,
    );
    const result = await commitPlannedEvents({
      accessToken,
      appId: String(appId),
      events: plannedEvents,
    });

    analytics.wizardCapture('planned events committed', {
      attempted: result.attempted,
      created: result.created,
      described: result.described,
      'error message': result.error ?? '',
    });

    logToFile(
      `[commitPlannedEventsStep] result attempted=${result.attempted} created=${
        result.created
      } described=${result.described} error=${result.error ?? ''}`,
    );

    if (result.created === 0) return '';
    const eventWord = result.created === 1 ? 'event' : 'events';
    return `Added ${result.created} planned ${eventWord} to your tracking plan`;
  } catch (err) {
    logToFile(
      `[commitPlannedEventsStep] unexpected error: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return '';
  }
}
