import {
  DEFAULT_PACKAGE_INSTALLATION,
  SPINNER_MESSAGE,
  type FrameworkConfig,
} from './framework-config';
import { type WizardSession, OutroKind } from './wizard-session';
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
  AgentSignals,
  AgentErrorType,
  buildWizardMetadata,
  checkClaudeSettingsOverrides,
  backupAndFixClaudeSettings,
  restoreClaudeSettings,
} from './agent-interface';
import { getLlmGatewayUrlFromHost } from '../utils/urls';
import { OUTBOUND_URLS } from './constants.js';
import { getVersionCheckInfo, getVersionWarning } from './version-check';

import { enableDebugLogs, logToFile } from '../utils/debug';
import { createObservabilityMiddleware } from './middleware/observability';
import { MiddlewarePipeline } from './middleware/pipeline';
import { createBenchmarkPipeline } from './middleware/benchmark';
import { wizardAbort, WizardError } from '../utils/wizard-abort';
import { GENERIC_AGENT_CONFIG } from '../frameworks/generic/generic-wizard-agent';

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
): Promise<void> {
  if (session.debug) {
    enableDebugLogs();
  }

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
      return;
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
        try {
          const refreshed = await refreshAccessToken(stored.refreshToken);
          storeToken(user, {
            accessToken: refreshed.accessToken,
            idToken: refreshed.idToken,
            refreshToken: refreshed.refreshToken,
            expiresAt: refreshed.expiresAt,
          });
          accessToken = refreshed.accessToken;
        } catch {
          // Refresh failed — proceed with the existing token; auth error will surface during the run
        }
      }
    }
  } catch {
    // Fall back to whatever the TUI provided
  }
  // Derive cloudRegion from session (set during auth or defaulting to 'us')
  const cloudRegion: import('../utils/types.js').CloudRegion =
    (session.pendingAuthCloudRegion as
      | import('../utils/types.js').CloudRegion
      | null) ?? 'us';

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

  const integrationPrompt = buildIntegrationPrompt(
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
  );

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
  // Benchmark middleware (token/cost tracking) is opt-in via --benchmark.
  const middleware = session.benchmark
    ? createBenchmarkPipeline(spinner, sessionToOptions(session))
    : new MiddlewarePipeline([createObservabilityMiddleware()]);

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
      additionalFeatureQueue: session.additionalFeatureQueue,
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
    });
  }

  if (agentResult.error === AgentErrorType.MCP_MISSING) {
    await wizardAbort({
      message: `Could not access the Amplitude MCP server\n\nThe wizard was unable to connect to the Amplitude MCP server.\nThis could be due to a network issue or a configuration problem.\n\nPlease try again, or set up ${config.metadata.name} manually by following our documentation:\n${config.metadata.docsUrl}`,
      error: new WizardError('Agent could not access Amplitude MCP server', {
        integration: config.metadata.integration,
        'error type': AgentErrorType.MCP_MISSING,
        signal: AgentSignals.ERROR_MCP_MISSING,
      }),
    });
  }

  if (agentResult.error === AgentErrorType.RESOURCE_MISSING) {
    await wizardAbort({
      message: `Could not access the setup resource\n\nThe wizard could not access the setup resource. This may indicate a version mismatch or a temporary service issue.\n\nPlease try again, or set up ${config.metadata.name} manually by following our documentation:\n${config.metadata.docsUrl}`,
      error: new WizardError('Agent could not access setup resource', {
        integration: config.metadata.integration,
        'error type': AgentErrorType.RESOURCE_MISSING,
        signal: AgentSignals.ERROR_RESOURCE_MISSING,
      }),
    });
  }

  if (
    agentResult.error === AgentErrorType.RATE_LIMIT ||
    agentResult.error === AgentErrorType.API_ERROR
  ) {
    captureWizardError(
      'Agent API',
      agentResult.message ?? 'Unknown API error',
      'agent-runner',
      {
        integration: config.metadata.integration,
        'error type': agentResult.error,
      },
    );

    await wizardAbort({
      message: `API Error\n\n${
        agentResult.message || 'Unknown error'
      }\n\nPlease report this error to: wizard@amplitude.com`,
      error: new WizardError(`API error: ${agentResult.message ?? 'unknown'}`, {
        integration: config.metadata.integration,
        'error type': agentResult.error,
      }),
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
  // once for human-operator modes (interactive TUI + CI-with-oversight).
  // Suppressed for --agent/NDJSON mode: agent orchestrators run against
  // fresh processes or test apps, not a human-managed dev server.
  if (!session.agent && Object.keys(envVars).length > 0) {
    getUI().pushStatus(
      `Your Amplitude env var is set. If your dev server or build was already running, restart it (with whatever command you started it with) so the new value loads — then click around your app and we'll wait for events.`,
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

  getUI().outro(`Successfully installed Amplitude!`);

  await analytics.shutdown('success');
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
   If the tool fails, emit: ${
     AgentSignals.ERROR_MCP_MISSING
   } Could not load skill menu and halt.

   Choose a skill from the \`integration\` category that matches this project's framework. Do NOT pick skills from other categories (error-tracking, feature-flags, etc.) — those are handled separately.
   If no suitable integration skill is found, emit: ${
     AgentSignals.ERROR_RESOURCE_MISSING
   } Could not find a suitable skill for this project.

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
