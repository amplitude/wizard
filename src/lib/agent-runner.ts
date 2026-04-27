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
  checkClaudeSettingsOverrides,
  backupAndFixClaudeSettings,
  restoreClaudeSettings,
} from './agent-interface';
import { getLlmGatewayUrlFromHost } from '../utils/urls';
import { DEFAULT_AMPLITUDE_ZONE, OUTBOUND_URLS } from './constants.js';
import { resolveZone } from './zone-resolution.js';
import { getVersionCheckInfo, getVersionWarning } from './version-check';

import { saveCheckpoint } from './session-checkpoint.js';
import { enableDebugLogs, logToFile } from '../utils/debug';
import { createObservabilityMiddleware } from './middleware/observability';
import { MiddlewarePipeline } from './middleware/pipeline';
import { createBenchmarkPipeline } from './middleware/benchmark';
import { createRetryMiddleware } from './middleware/retry';
import { wizardAbort, WizardError } from '../utils/wizard-abort';
import { ExitCode } from './exit-codes';
import { GENERIC_AGENT_CONFIG } from '../frameworks/generic/generic-wizard-agent';

/** Path the wizard writes its debug log to — referenced in user-facing error copy. */
const LOG_FILE_PATH = '/tmp/amplitude-wizard.log';
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
  const { ensureWizardArtifactsIgnored, cleanupWizardArtifacts } = await import(
    './wizard-tools.js'
  );
  ensureWizardArtifactsIgnored(session.installDir);

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
  const success = await runAgentWizardBody(
    config,
    session,
    getAdditionalFeatureQueue,
    featureProgress,
  );
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
      getUI().cancel(
        `The wizard requires ${packageDisplayName} ${minimumVersion} or later, but found version ${version}. Upgrade your ${packageDisplayName} version to use the wizard, or follow the manual setup guide.`,
        { docsUrl },
      );
      logToFile('[runAgentWizard] cancel displayed to user');
      // Non-success early return — caller skips success-path cleanup so
      // the integration skill (and any prior `.amplitude-events.json`)
      // stays on disk for a clean re-run after the user upgrades.
      return false;
    }
  }

  // Setup phase — informational only, no prompts
  // Beta notice, pre-run notice, and welcome label are all derivable
  // from session.frameworkConfig — IntroScreen reads them directly.

  // Check for blocking env overrides in .claude/settings.json before login.
  // These keys block the Wizard from accessing the Amplitude LLM Gateway.
  const blockingOverrideKeys = checkClaudeSettingsOverrides(session.installDir);
  if (blockingOverrideKeys.length > 0) {
    await getUI().showSettingsOverride(blockingOverrideKeys, () =>
      backupAndFixClaudeSettings(session.installDir),
    );
  }

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
      workspaceId: session.selectedWorkspaceId,
      workspaceName: session.selectedWorkspaceName,
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
      // Silently refresh if the access token has expired but the refresh window is still valid
      if (user && new Date() > new Date(stored.expiresAt)) {
        const refreshStartedAt = Date.now();
        try {
          const refreshed = await refreshAccessToken(stored.refreshToken);
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

  const integrationPrompt =
    buildIntegrationPrompt(
      config,
      {
        frameworkVersion: frameworkVersion || 'latest',
        typescript: typeScriptDetected,
        projectApiKey,
        host,
        appId,
      },
      frameworkContext,
      skipAmplitudeMcp,
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

  const restoreSettings = () => restoreClaudeSettings(session.installDir);
  getUI().onEnterScreen('outro', restoreSettings);
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

  if (agentResult.error === AgentErrorType.MCP_MISSING) {
    await wizardAbort({
      message: `Could not access the Amplitude MCP server\n\nThe wizard was unable to connect to the Amplitude MCP server.\nThis could be due to a network issue or a configuration problem.\n\nPlease try again, or set up ${config.metadata.name} manually by following our documentation:\n${config.metadata.docsUrl}`,
      error: new WizardError('Agent could not access Amplitude MCP server', {
        integration: config.metadata.integration,
        'error type': AgentErrorType.MCP_MISSING,
      }),
      exitCode: ExitCode.AGENT_FAILED,
    });
  }

  if (agentResult.error === AgentErrorType.RESOURCE_MISSING) {
    await wizardAbort({
      message: `Could not access the setup resource\n\nThe wizard could not access the setup resource. This may indicate a version mismatch or a temporary service issue.\n\nPlease try again, or set up ${config.metadata.name} manually by following our documentation:\n${config.metadata.docsUrl}`,
      error: new WizardError('Agent could not access setup resource', {
        integration: config.metadata.integration,
        'error type': AgentErrorType.RESOURCE_MISSING,
      }),
      exitCode: ExitCode.AGENT_FAILED,
    });
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
      }). This is an issue with the Amplitude LLM gateway, not your project.\n\n${buildGatewayBypassHint()}\n\nIf this persists, please report it (with the log file at ${LOG_FILE_PATH}) to: ${SUPPORT_EMAIL}`,
      error: new WizardError(
        `LLM gateway unavailable: ${agentResult.message ?? 'unknown'}`,
        {
          integration: config.metadata.integration,
          'error type': agentResult.error,
          'using direct key': usingDirectKey,
        },
      ),
      exitCode: ExitCode.NETWORK_ERROR,
    });
  }

  if (
    agentResult.error === AgentErrorType.RATE_LIMIT ||
    agentResult.error === AgentErrorType.API_ERROR
  ) {
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
    //
    // Surfacing each subtype as its own Sentry tag lets us slice and
    // alert separately, especially `stream_closed` which we expect to
    // be near-zero post-#298.
    const rawMessage = agentResult.message ?? '';
    const errorSubtype = classifyApiErrorSubtype({
      errorType: agentResult.error,
      message: rawMessage,
    });

    captureWizardError(
      'Agent API',
      rawMessage || 'Unknown API error',
      'agent-runner',
      {
        integration: config.metadata.integration,
        'error type': agentResult.error,
        'error subtype': errorSubtype,
        'using direct key': !!process.env.ANTHROPIC_API_KEY,
      },
    );

    let userMessage: string;
    switch (errorSubtype) {
      case 'stream_closed':
        // Stream closed survived past the inner retry loop's defense in
        // depth (#298). Frame it as a connection issue with the same
        // upstream-gateway treatment as terminated_400 — same family of
        // root cause, same workaround.
        userMessage = `LLM gateway connection lost\n\nThe wizard couldn't keep a stable connection to the Amplitude LLM gateway across retries (${rawMessage}). Re-running the wizard usually clears this up.\n\n${buildGatewayBypassHint()}\n\nIf this persists, please report it (with ${LOG_FILE_PATH}) to: ${SUPPORT_EMAIL}`;
        break;
      case 'terminated_400':
        userMessage = `LLM gateway dropped the connection\n\nThe Amplitude LLM gateway terminated the request mid-flight (${rawMessage}). Some progress was made before this happened — re-running the wizard usually finishes the job.\n\n${buildGatewayBypassHint()}\n\nIf this persists, please report it (with ${LOG_FILE_PATH}) to: ${SUPPORT_EMAIL}`;
        break;
      case 'rate_limit':
        userMessage = `Rate limit reached\n\nThe LLM gateway is rate-limiting requests (${
          rawMessage || 'API Error: 429'
        }). Wait a minute or two and re-run the wizard.\n\n${buildGatewayBypassHint()}`;
        break;
      case 'other':
        userMessage = `LLM gateway error\n\n${
          rawMessage || 'Unknown error'
        }\n\nThis is typically an upstream issue with the Amplitude LLM gateway, not your project. Re-running the wizard usually works.\n\n${buildGatewayBypassHint()}\n\nIf this persists, please report it (with ${LOG_FILE_PATH}) to: ${SUPPORT_EMAIL}`;
        break;
    }

    await wizardAbort({
      message: userMessage,
      error: new WizardError(`API error: ${rawMessage || 'unknown'}`, {
        integration: config.metadata.integration,
        'error type': agentResult.error,
        'error subtype': errorSubtype,
      }),
      exitCode: ExitCode.NETWORK_ERROR,
    });
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
      const ws =
        org && session.selectedWorkspaceId
          ? org.workspaces.find((w) => w.id === session.selectedWorkspaceId)
          : org?.workspaces[0];
      appId =
        ws?.environments
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

  while (Date.now() < deadline) {
    pollCount++;
    logToFile(`[pollForDataIngestion] poll #${pollCount} appId=${appId}`);

    try {
      const result = await fetchHasAnyEventsMcp(accessToken, appId);
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
    }

    // Wait before the next poll, but bail early if deadline passed.
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.min(POLL_INTERVAL_MS, remaining)),
    );
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
 */
function buildIntegrationPrompt(
  config: FrameworkConfig,
  context: {
    frameworkVersion: string;
    typescript: boolean;
    projectApiKey: string;
    host: string;
    appId: number;
  },
  frameworkContext: Record<string, unknown>,
  skipAmplitudeMcp: boolean,
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

  const additionalLines = config.prompts.getAdditionalContextLines
    ? config.prompts.getAdditionalContextLines(frameworkContext)
    : [];

  const additionalContext =
    additionalLines.length > 0
      ? '\n' + additionalLines.map((line) => `- ${line}`).join('\n')
      : '';

  return `You are setting up Amplitude analytics in this ${
    config.metadata.name
  } project. Use the wizard-tools MCP server to load and install skills.

Project context:
- Amplitude App ID (shown in Amplitude UI as "Project ID"): ${context.appId}
- Framework: ${config.metadata.name} ${context.frameworkVersion}
- TypeScript: ${context.typescript ? 'Yes' : 'No'}
- Amplitude public token: ${context.projectApiKey}
- Amplitude Host: ${context.host}
- Project type: ${config.prompts.projectTypeDetection}
- Package installation: ${
    config.prompts.packageInstallation ?? DEFAULT_PACKAGE_INSTALLATION
  }${additionalContext}

Instructions (follow these steps IN ORDER - do not skip or reorder):

STEP 1: Call load_skill_menu (from the wizard-tools MCP server) to see available skills.
   If the tool fails, call report_status with kind="error", code="MCP_MISSING", detail="Could not load skill menu" and halt.

   Choose a skill from the \`integration\` category that matches this project's framework. Do NOT pick skills from other categories (error-tracking, feature-flags, etc.) — those are handled separately.
   If no suitable integration skill is found, call report_status with kind="error", code="RESOURCE_MISSING", detail="Could not find a suitable skill for this project" and halt.

STEP 2: Call install_skill (from the wizard-tools MCP server) with the chosen skill ID (e.g., "integration-nextjs-app-router").
   Do NOT run any shell commands to install skills.

STEP 3: Load the installed skill's SKILL.md file to understand what references are available.

STEP 4: Follow the skill's workflow files in sequence. Look for numbered workflow files in the references (e.g., files with patterns like "1.0-", "1.1-", "1.2-"). Start with the first one and proceed through each step until completion. Each workflow file will tell you what to do and which file comes next. Never directly write Amplitude tokens directly to code files; always use environment variables.

STEP 5: Set up environment variables for Amplitude using the wizard-tools MCP server (this runs locally — secret values never leave the machine):
   - Use check_env_keys to see which keys already exist in the project's .env file (e.g. .env.local or .env).
   - Use set_env_values to create or update the Amplitude public token and host, using the appropriate environment variable naming convention for ${
     config.metadata.name
   }, which you'll find in example code. The tool will also ensure .gitignore coverage. Don't assume the presence of keys means the value is up to date. Write the correct value each time.
   - Reference these environment variables in the code files you create instead of hardcoding the public token and host.

STEP 6: Add event tracking to this project using the instrumentation skills.
   - If you enabled Amplitude Autocapture in the SDK init code during integration (typical for web SDKs, not for Swift unless the plugin was added, and not applicable to backend SDKs), the events you propose to confirm_event_plan MUST exclude anything Autocapture already covers for this platform — no "Clicked", "Tapped", "Submitted", or "Viewed" events. If Autocapture is off or unsupported, propose events normally but still favor business-outcome and state-change events over raw interaction events.
   - Call load_skill_menu with category "taxonomy" and install **amplitude-quickstart-taxonomy-agent** using install_skill. Load its SKILL.md and follow it when **naming events**, choosing **properties**, and scoping a **starter-kit taxonomy** (business-outcome events, property limits, funnel/linkage rules). Keep using this skill alongside instrumentation so names stay analysis-ready.
   - Call load_skill_menu with category "instrumentation" to see available instrumentation skills.
   - Install the "add-analytics-instrumentation" skill using install_skill.
   - Load the installed skill's SKILL.md file to understand the workflow.
   - Follow the skill's workflow using the "File / Directory" input type: analyze the project's main source directory to discover user-facing features and surfaces that should be instrumented.
   - The skill will guide you through discovering candidate events, filtering to the most critical ones, and producing a concrete tracking plan with exact file locations and tracking code.
   - Implement the tracking calls for all priority-3 (critical) events identified by the skill.

Important: Use the detect_package_manager tool (from the wizard-tools MCP server) to determine which package manager the project uses. Do not manually search for lockfiles or config files. Always install packages as a background task. Don't await completion; proceed with other work immediately after starting the installation. You must read a file immediately before attempting to write it, even if you have previously read it; failure to do so will cause a tool failure.


`;
}
