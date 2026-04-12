#!/usr/bin/env node
import { satisfies } from 'semver';
import { red } from './src/utils/logging';
import { config as loadDotenv } from 'dotenv';
loadDotenv();

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import chalk from 'chalk';

import { readFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { z } from 'zod';

const WIZARD_VERSION: string = (() => {
  // npm/pnpm set this when running via package scripts
  if (process.env.npm_package_version) return process.env.npm_package_version;
  // Fallback: read package.json relative to this file
  try {
    const pkg = z
      .object({ version: z.string().optional() })
      .passthrough()
      .parse(
        JSON.parse(
          readFileSync(
            resolve(dirname(__filename), '..', 'package.json'),
            'utf-8',
          ),
        ),
      );
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

const NODE_VERSION_RANGE = '>=18.17.0';

// Have to run this above the other imports because they are importing clack that
// has the problematic imports.
if (!satisfies(process.version, NODE_VERSION_RANGE)) {
  red(
    `Amplitude wizard requires Node.js ${NODE_VERSION_RANGE}. You are using Node.js ${process.version}. Please upgrade your Node.js version.`,
  );
  process.exit(1);
}

import { runWizard } from './src/run';
import { isNonInteractiveEnvironment } from './src/utils/environment';
import { getUI, setUI } from './src/ui';
import { LoggingUI } from './src/ui/logging-ui';
import {
  ZSH_COMPLETION_SCRIPT,
  BASH_COMPLETION_SCRIPT,
} from './src/utils/shell-completions';
import { persistApiKey } from './src/utils/api-key-store';

if (process.env.NODE_ENV === 'test') {
  void (async () => {
    try {
      const { server } = await import('./e2e-tests/mocks/server.js');
      server.listen({
        onUnhandledRequest: 'bypass',
      });
    } catch {
      // Mock server import failed - this can happen during non-E2E tests
    }
  })();
}

void yargs(hideBin(process.argv))
  .env('AMPLITUDE_WIZARD')
  // global options
  .options({
    debug: {
      default: false,
      describe: 'Enable verbose logging\nenv: AMPLITUDE_WIZARD_DEBUG',
      type: 'boolean',
    },
    verbose: {
      default: false,
      describe:
        'Print diagnostic info (working dir, config, etc.) to the log\nenv: AMPLITUDE_WIZARD_VERBOSE',
      type: 'boolean',
    },
    default: {
      default: true,
      describe:
        'Use default options for all prompts\nenv: AMPLITUDE_WIZARD_DEFAULT',
      type: 'boolean',
    },
    signup: {
      default: false,
      describe:
        'Create a new Amplitude account during setup\nenv: AMPLITUDE_WIZARD_SIGNUP',
      type: 'boolean',
    },
    'local-mcp': {
      default: false,
      describe:
        'Use local MCP server at http://localhost:8787/mcp\nenv: AMPLITUDE_WIZARD_LOCAL_MCP',
      type: 'boolean',
    },
    ci: {
      default: false,
      describe:
        'Enable CI mode for non-interactive execution\nenv: AMPLITUDE_WIZARD_CI',
      type: 'boolean',
    },
    'api-key': {
      describe:
        'Amplitude API key for authentication\nenv: AMPLITUDE_WIZARD_API_KEY',
      type: 'string',
    },
    'project-id': {
      describe:
        'Amplitude project ID to use (optional; when not set, uses default from API key or OAuth)\nenv: AMPLITUDE_WIZARD_PROJECT_ID',
      type: 'string',
    },
  })
  .command(
    ['$0'],
    'Run the Amplitude setup wizard',
    (yargs) => {
      return yargs.options({
        'force-install': {
          default: false,
          describe:
            'Force install packages even if peer dependency checks fail\nenv: AMPLITUDE_WIZARD_FORCE_INSTALL',
          type: 'boolean',
        },
        'install-dir': {
          describe:
            'Directory to install Amplitude in\nenv: AMPLITUDE_WIZARD_INSTALL_DIR',
          type: 'string',
        },
        integration: {
          describe: 'Integration to set up',
          choices: [
            'nextjs',
            'vue',
            'react-router',
            'django',
            'flask',
            'fastapi',
            'javascript_web',
            'javascript_node',
            'python',
          ],
          type: 'string',
        },
        menu: {
          default: false,
          describe:
            'Show menu for manual integration selection instead of auto-detecting\nenv: AMPLITUDE_WIZARD_MENU',
          type: 'boolean',
        },
        benchmark: {
          default: false,
          describe:
            'Run in benchmark mode with per-phase token tracking\nenv: AMPLITUDE_WIZARD_BENCHMARK',
          type: 'boolean',
        },
      });
    },
    (argv) => {
      const options = { ...argv };

      // CI mode validation and TTY check
      if (options.ci) {
        // Use LoggingUI for CI mode (no dependencies, no prompts)
        setUI(new LoggingUI());
        if (!options.installDir) {
          getUI().intro(chalk.inverse(`Amplitude Wizard`));
          getUI().log.error(
            'CI mode requires --install-dir (directory to install Amplitude in)',
          );
          process.exit(1);
        }

        void runWizard(options as Parameters<typeof runWizard>[0]);
      } else if (isNonInteractiveEnvironment()) {
        // Non-interactive non-CI: error out
        getUI().intro(chalk.inverse(`Amplitude Wizard`));
        getUI().log.error(
          'This installer requires an interactive terminal (TTY) to run.\n' +
            'It appears you are running in a non-interactive environment.\n' +
            'Please run the wizard in an interactive terminal.\n\n' +
            'For CI/CD environments, use --ci mode:\n' +
            '  npx @amplitude/wizard --ci --install-dir . [--api-key <your-key>]\n' +
            '  (--api-key is optional when a key can be resolved from env or stored credentials.)',
        );
        process.exit(1);
      } else {
        // Interactive TTY: launch the Ink TUI
        void (async () => {
          // Silently install shell completions on first run.
          const { installCompletions } = await import(
            './src/utils/shell-completions.js'
          );
          installCompletions();

          try {
            const { startTUI } = await import('./src/ui/tui/start-tui.js');
            const { buildSession } = await import(
              './src/lib/wizard-session.js'
            );

            const tui = startTUI(WIZARD_VERSION);

            // Build session from CLI args and attach to store
            const session = buildSession({
              debug: options.debug as boolean | undefined,
              verbose: options.verbose as boolean | undefined,
              forceInstall: options.forceInstall as boolean | undefined,
              installDir: options.installDir as string | undefined,
              ci: false,
              signup: options.signup as boolean | undefined,
              localMcp: options.localMcp as boolean | undefined,
              apiKey: options.apiKey as string | undefined,
              menu: options.menu as boolean | undefined,
              integration: options.integration as Parameters<
                typeof buildSession
              >[0]['integration'],
              benchmark: options.benchmark as boolean | undefined,
              projectId: options.projectId as string | undefined,
            });

            // If --api-key was provided, skip the OAuth/TUI auth flow entirely.
            if (session.apiKey) {
              const { DEFAULT_HOST_URL } = await import(
                './src/lib/constants.js'
              );
              session.credentials = {
                accessToken: session.apiKey,
                projectApiKey: session.apiKey,
                host: DEFAULT_HOST_URL,
                projectId: session.projectId ?? 0,
              };
              session.projectHasData = false;
            } else {
              // Pre-populate region + credentials from all available sources for
              // returning users. This skips RegionSelect and Auth without requiring
              // a persisted OAuth token.
              const installDir = session.installDir;
              const [
                { getStoredUser, getStoredToken },
                { readAmpliConfig },
                { getAPIKey },
                { getHostFromRegion },
                { logToFile },
                { fetchAmplitudeUser },
              ] = await Promise.all([
                import('./src/utils/ampli-settings.js'),
                import('./src/lib/ampli-config.js'),
                import('./src/utils/get-api-key.js'),
                import('./src/utils/urls.js'),
                import('./src/utils/debug.js'),
                import('./src/lib/api.js'),
              ]);

              // Zone: prefer a real (non-pending) stored user, fall back to
              // the Zone field in the project-level ampli.json.
              const storedUser = getStoredUser();
              const realUser =
                storedUser && storedUser.id !== 'pending' ? storedUser : null;
              const projectConfig = readAmpliConfig(installDir);
              const projectZone = projectConfig.ok
                ? projectConfig.config.Zone
                : undefined;
              const zone = realUser?.zone ?? projectZone ?? null;

              logToFile(
                `[bin][DEBUG] returning-user path: realUser=${!!realUser}, zone=${zone}, projectZone=${projectZone}`,
              );

              if (zone) {
                session.region = zone;
              }

              // Skip Auth when we have a stored OAuth token — use it to fetch
              // (or look up) the project API key, then pre-populate credentials.
              // When the workspace has multiple environments (projects), defer to
              // AuthScreen so the user can pick which project to instrument.
              if (zone) {
                const storedToken = realUser
                  ? getStoredToken(realUser.id, realUser.zone)
                  : getStoredToken(undefined, zone);

                if (storedToken) {
                  logToFile(
                    '[bin][DEBUG] storedToken found, checking local key',
                  );
                  // Check local storage first — if a key is already persisted
                  // for this install dir, use it without fetching user data.
                  const { readApiKeyWithSource } = await import(
                    './src/utils/api-key-store.js'
                  );
                  const localKey = readApiKeyWithSource(installDir);
                  logToFile(
                    `[bin][DEBUG] localKey=${
                      localKey
                        ? `found (source=${localKey.source})`
                        : 'not found'
                    }`,
                  );

                  if (localKey) {
                    logToFile('[bin] using locally stored API key');
                    session.credentials = {
                      accessToken: storedToken.accessToken,
                      idToken: storedToken.idToken,
                      projectApiKey: localKey.key,
                      host: getHostFromRegion(zone),
                      projectId: 0,
                    };
                    session.activationLevel = 'none';
                    session.projectHasData = false;

                    // Fetch org/workspace names so /whoami and title bar work.
                    try {
                      const userInfo = await fetchAmplitudeUser(
                        storedToken.idToken,
                        zone,
                      );
                      // Match API key to find the right org/workspace/env
                      for (const org of userInfo.orgs) {
                        for (const ws of org.workspaces) {
                          const env = ws.environments?.find(
                            (e) => e.app?.apiKey === localKey.key,
                          );
                          if (env) {
                            session.selectedOrgId = org.id;
                            session.selectedOrgName = org.name;
                            session.selectedWorkspaceId = ws.id;
                            session.selectedWorkspaceName = ws.name;
                            session.selectedProjectName = env.name;
                            logToFile(
                              `[bin] resolved org/ws for local key: org="${org.name}", ws="${ws.name}", env="${env.name}"`,
                            );
                            break;
                          }
                        }
                        if (session.selectedOrgName) break;
                      }
                    } catch {
                      logToFile(
                        '[bin] could not resolve org data for local key — continuing without names',
                      );
                    }
                  } else {
                    // Fetch user data to check how many environments are available.
                    // fetchAmplitudeUser is already in scope from the Promise.all above.
                    try {
                      const userInfo = await fetchAmplitudeUser(
                        storedToken.idToken,
                        zone,
                      );
                      // DEBUG: log the raw org/workspace structure
                      logToFile(
                        `[bin][DEBUG] userInfo.orgs: ${JSON.stringify(
                          userInfo.orgs.map((o) => ({
                            orgId: o.id,
                            orgName: o.name,
                            workspaces: o.workspaces.map((w) => ({
                              wsId: w.id,
                              wsName: w.name,
                              envs: w.environments?.map((e) => ({
                                envName: e.name,
                                rank: e.rank,
                                hasKey: !!e.app?.apiKey,
                              })),
                            })),
                          })),
                          null,
                          2,
                        )}`,
                      );

                      const workspaceId =
                        session.selectedWorkspaceId ?? undefined;

                      // Find the relevant workspace and its environments
                      let envsWithKey: Array<{
                        name: string;
                        rank: number;
                        app: {
                          id: string;
                          apiKey?: string | null;
                        } | null;
                      }> = [];
                      let matchedOrg:
                        | (typeof userInfo.orgs)[number]
                        | undefined;
                      let matchedWs:
                        | (typeof userInfo.orgs)[number]['workspaces'][number]
                        | undefined;
                      for (const org of userInfo.orgs) {
                        const ws = workspaceId
                          ? org.workspaces.find((w) => w.id === workspaceId)
                          : org.workspaces[0];
                        if (ws?.environments) {
                          matchedOrg = org;
                          matchedWs = ws;
                          envsWithKey = ws.environments
                            .filter((env) => env.app?.apiKey)
                            .sort((a, b) => a.rank - b.rank);
                          break;
                        }
                      }

                      if (envsWithKey.length === 1) {
                        // Single environment — auto-select as before
                        const apiKey = envsWithKey[0].app!.apiKey!;
                        session.selectedProjectName = envsWithKey[0].name;
                        // Capture org/workspace info from the already-fetched data
                        if (matchedOrg) {
                          session.selectedOrgId = matchedOrg.id;
                          session.selectedOrgName = matchedOrg.name;
                        }
                        if (matchedWs) {
                          session.selectedWorkspaceId = matchedWs.id;
                          session.selectedWorkspaceName = matchedWs.name;
                        }
                        logToFile(
                          `[bin] single environment — auto-selecting API key. ` +
                            `orgName=${matchedOrg?.name}, wsName=${matchedWs?.name}, ` +
                            `projectName=${envsWithKey[0].name}`,
                        );
                        persistApiKey(apiKey, installDir);
                        session.credentials = {
                          accessToken: storedToken.accessToken,
                          idToken: storedToken.idToken,
                          projectApiKey: apiKey,
                          host: getHostFromRegion(zone),
                          projectId: 0,
                        };
                        session.activationLevel = 'none';
                        session.projectHasData = false;
                      } else if (envsWithKey.length > 1) {
                        // Multiple environments — show the project picker via
                        // AuthScreen instead of auto-selecting.
                        logToFile(
                          `[bin] ${envsWithKey.length} environments found — deferring to project picker`,
                        );
                        session.pendingOrgs = userInfo.orgs;
                        session.pendingAuthIdToken = storedToken.idToken;
                        session.pendingAuthAccessToken =
                          storedToken.accessToken;
                      } else {
                        logToFile(
                          '[bin] no environments with API keys — showing apiKeyNotice',
                        );
                        session.apiKeyNotice =
                          "Your API key couldn't be fetched automatically. " +
                          'Only organization admins can access project API keys — ' +
                          'if you need one, ask an admin to share it with you.';
                      }
                    } catch (err) {
                      logToFile(
                        `[bin] fetchAmplitudeUser failed: ${
                          err instanceof Error ? err.message : 'unknown'
                        }`,
                      );
                      // Fall back to getAPIKey for backward compatibility
                      const projectApiKey = await getAPIKey({
                        installDir,
                        idToken: storedToken.idToken,
                        zone,
                        workspaceId: session.selectedWorkspaceId ?? undefined,
                      });
                      if (projectApiKey) {
                        persistApiKey(projectApiKey, installDir);
                        session.credentials = {
                          accessToken: storedToken.accessToken,
                          idToken: storedToken.idToken,
                          projectApiKey,
                          host: getHostFromRegion(zone),
                          projectId: 0,
                        };
                        session.activationLevel = 'none';
                        session.projectHasData = false;
                      } else {
                        session.apiKeyNotice =
                          "Your API key couldn't be fetched automatically. " +
                          'Only organization admins can access project API keys — ' +
                          'if you need one, ask an admin to share it with you.';
                      }
                    }
                  }
                }
              }

              // Pre-populate org/workspace from ampli.json so activation checks
              // (DataSetupScreen, DataIngestionCheckScreen) have the IDs they need
              // even when the SUSI flow was skipped. Only overwrite if not already
              // set by the single-env auto-select path above.
              if (
                projectConfig.ok &&
                projectConfig.config.OrgId &&
                !session.selectedOrgId
              ) {
                session.selectedOrgId = String(projectConfig.config.OrgId);
              }
              if (
                projectConfig.ok &&
                projectConfig.config.WorkspaceId &&
                !session.selectedWorkspaceId
              ) {
                session.selectedWorkspaceId = projectConfig.config.WorkspaceId;
              }

              // Resolve org/workspace display names so /whoami shows them.
              // Skip if already resolved by the local-key or single-env paths above.
              if (zone && session.selectedOrgId && !session.selectedOrgName) {
                const nameToken = realUser
                  ? getStoredToken(realUser.id, realUser.zone)
                  : getStoredToken(undefined, zone);
                if (nameToken) {
                  try {
                    const userInfo = await fetchAmplitudeUser(
                      nameToken.idToken,
                      zone,
                    );
                    const org = userInfo.orgs.find(
                      (o) => o.id === session.selectedOrgId,
                    );
                    if (org) {
                      session.selectedOrgName = org.name;
                      const ws = session.selectedWorkspaceId
                        ? org.workspaces.find(
                            (w) => w.id === session.selectedWorkspaceId,
                          )
                        : undefined;
                      if (ws) {
                        session.selectedWorkspaceName = ws.name;
                      }
                    }
                  } catch {
                    logToFile(
                      '[bin] name resolution failed — continuing without org names',
                    );
                  }
                }
              }
            }

            tui.store.session = session;

            // Initialize Amplitude Experiment feature flags (non-blocking).
            const { initFeatureFlags } = await import(
              './src/lib/feature-flags.js'
            );
            await initFeatureFlags().catch(() => {
              // Flag init failure is non-fatal — all flags default to off
            });

            // Apply SDK-level opt-out based on feature flags
            const { analytics } = await import('./src/utils/analytics.js');
            analytics.applyOptOut();

            const { FRAMEWORK_REGISTRY } = await import(
              './src/lib/registry.js'
            );
            const { detectIntegration } = await import('./src/run.js');
            const installDir = session.installDir ?? process.cwd();

            // Verbose startup diagnostics — always written to the log file;
            // visible in the RunScreen "Logs" tab.
            if (session.verbose || session.debug) {
              const { enableDebugLogs, logToFile } = await import(
                './src/utils/debug.js'
              );
              enableDebugLogs();
              logToFile('[verbose] Amplitude Wizard starting');
              logToFile(`[verbose] node          : ${process.version}`);
              logToFile(`[verbose] process.cwd() : ${process.cwd()}`);
              logToFile(`[verbose] installDir    : ${installDir}`);
              logToFile(`[verbose] platform      : ${process.platform}`);
              logToFile(`[verbose] argv          : ${process.argv.join(' ')}`);
            }

            const { DETECTION_TIMEOUT_MS } = await import(
              './src/lib/constants.js'
            );

            // ── OAuth + account setup ──────────────────────────────
            // Runs concurrently with framework detection while AuthScreen shows.
            // When OAuth completes, store.setOAuthComplete() triggers the
            // AuthScreen SUSI pickers (org → workspace → API key).
            // AuthScreen calls store.setCredentials() when done, advancing the
            // router past Auth → RegionSelect → DataSetup → to IntroScreen.
            const authTask = (async () => {
              // Skip the full OAuth + SUSI flow when credentials were pre-populated
              // from ~/.ampli.json + the saved API key (returning user).
              if (tui.store.session.credentials !== null) return;

              try {
                const { ampliConfigExists } = await import(
                  './src/lib/ampli-config.js'
                );
                const { performAmplitudeAuth } = await import(
                  './src/utils/oauth.js'
                );
                const { fetchAmplitudeUser } = await import('./src/lib/api.js');
                const { DEFAULT_AMPLITUDE_ZONE } = await import(
                  './src/lib/constants.js'
                );
                const { storeToken } = await import(
                  './src/utils/ampli-settings.js'
                );

                const forceFresh = !ampliConfigExists(installDir);

                // Wait for the user to pick a region (or for it to be pre-populated
                // from ~/.ampli.json for returning users) before opening the OAuth URL,
                // since the auth endpoint differs between US and EU.
                await new Promise<void>((resolve) => {
                  if (tui.store.session.region !== null) {
                    resolve();
                    return;
                  }
                  const unsub = tui.store.subscribe(() => {
                    if (tui.store.session.region !== null) {
                      unsub();
                      resolve();
                    }
                  });
                });
                const zone =
                  tui.store.session.region === 'eu'
                    ? 'eu'
                    : DEFAULT_AMPLITUDE_ZONE;

                let auth = await performAmplitudeAuth({
                  zone,
                  forceFresh,
                });

                // Update login URL (clears the "copy this URL" hint)
                tui.store.setLoginUrl(null);

                // Zone was already selected by the user before OAuth started.
                const cloudRegion = zone;

                const { logToFile: logDebug } = await import(
                  './src/utils/debug.js'
                );
                logDebug(
                  '[bin][DEBUG] authTask: about to fetchAmplitudeUser, zone=',
                  cloudRegion,
                );
                let userInfo;
                try {
                  userInfo = await fetchAmplitudeUser(
                    auth.idToken,
                    cloudRegion,
                  );
                  logDebug(
                    '[bin][DEBUG] authTask: fetchAmplitudeUser succeeded',
                  );
                } catch (fetchErr) {
                  logDebug(
                    '[bin][DEBUG] authTask: fetchAmplitudeUser failed (1st attempt):',
                    fetchErr instanceof Error
                      ? fetchErr.message
                      : String(fetchErr),
                  );
                  // Token may be expired — re-open the browser for a fresh login
                  tui.store.setLoginUrl(null);
                  auth = await performAmplitudeAuth({ zone, forceFresh: true });
                  userInfo = await fetchAmplitudeUser(
                    auth.idToken,
                    cloudRegion,
                  );
                }

                // Persist to ~/.ampli.json
                storeToken(
                  {
                    id: userInfo.id,
                    firstName: userInfo.firstName,
                    lastName: userInfo.lastName,
                    email: userInfo.email,
                    zone: auth.zone,
                  },
                  {
                    accessToken: auth.accessToken,
                    idToken: auth.idToken,
                    refreshToken: auth.refreshToken,
                    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
                  },
                );

                // Signal AuthScreen — triggers org/workspace/API key pickers
                logDebug(
                  '[bin][DEBUG] setOAuthComplete — orgs:',
                  JSON.stringify(userInfo.orgs, null, 2),
                );
                tui.store.setOAuthComplete({
                  accessToken: auth.accessToken,
                  idToken: auth.idToken,
                  cloudRegion,
                  orgs: userInfo.orgs,
                });
              } catch (err) {
                // Auth failure is non-fatal here — agent-runner will retry/handle it
                const { logToFile: logErr } = await import(
                  './src/utils/debug.js'
                );
                logErr(
                  '[bin][DEBUG] authTask OUTER CATCH:',
                  err instanceof Error
                    ? `${err.message}\n${err.stack}`
                    : String(err),
                );
                if (process.env.DEBUG || process.env.AMPLITUDE_WIZARD_DEBUG) {
                  console.error('OAuth setup error:', err);
                }
              }
            })();

            // ── Framework detection ────────────────────────────────
            // Runs concurrently with auth while AuthScreen shows.
            const detectionTask = (async () => {
              const detectedIntegration = await Promise.race([
                detectIntegration(installDir),
                new Promise<undefined>((resolve) =>
                  setTimeout(() => resolve(undefined), DETECTION_TIMEOUT_MS),
                ),
              ]);

              if (detectedIntegration) {
                const config = FRAMEWORK_REGISTRY[detectedIntegration];

                // Run gatherContext for the friendly variant label
                if (config.metadata.gatherContext) {
                  try {
                    const context = await Promise.race([
                      config.metadata.gatherContext({
                        installDir,
                        debug: session.debug,
                        forceInstall: session.forceInstall,
                        default: false,
                        signup: session.signup,
                        localMcp: session.localMcp,
                        ci: session.ci,
                        menu: session.menu,
                        benchmark: session.benchmark,
                      }),
                      new Promise<Record<string, never>>((resolve) =>
                        setTimeout(() => resolve({}), DETECTION_TIMEOUT_MS),
                      ),
                    ]);
                    for (const [key, value] of Object.entries(context)) {
                      if (!(key in session.frameworkContext)) {
                        tui.store.setFrameworkContext(key, value);
                      }
                    }
                  } catch {
                    // Detection failed — will show generic name
                  }
                }

                tui.store.setFrameworkConfig(detectedIntegration, config);

                if (!session.detectedFrameworkLabel) {
                  tui.store.setDetectedFramework(config.metadata.name);
                }

                const { analytics: _binAnalytics } = await import(
                  './src/utils/analytics.js'
                );
                _binAnalytics.wizardCapture('Framework Detected', {
                  integration: detectedIntegration,
                  detected_label: config.metadata.name,
                });
              }

              // Feature discovery — deterministic scan of package.json deps
              try {
                const { readFileSync } = await import('fs');
                const pkgPath = join(installDir, 'package.json');
                const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
                  dependencies?: Record<string, string>;
                  devDependencies?: Record<string, string>;
                };
                const allDeps = {
                  ...pkg.dependencies,
                  ...pkg.devDependencies,
                };
                const depNames = Object.keys(allDeps);

                const { DiscoveredFeature } = await import(
                  './src/lib/wizard-session.js'
                );

                if (
                  depNames.some((d) =>
                    ['stripe', '@stripe/stripe-js'].includes(d),
                  )
                ) {
                  tui.store.addDiscoveredFeature(DiscoveredFeature.Stripe);
                }

                // LLM SDK detection — sourced from Amplitude LLM analytics skill
                // Gated by the wizard-llm-analytics feature flag.
                const { isFlagEnabled } = await import(
                  './src/lib/feature-flags.js'
                );
                const { FLAG_LLM_ANALYTICS } = await import(
                  './src/lib/feature-flags.js'
                );
                if (isFlagEnabled(FLAG_LLM_ANALYTICS)) {
                  const LLM_PACKAGES = [
                    'openai',
                    '@anthropic-ai/sdk',
                    'ai',
                    '@ai-sdk/openai',
                    'langchain',
                    '@langchain/openai',
                    '@langchain/langgraph',
                    '@google/generative-ai',
                    '@google/genai',
                    '@instructor-ai/instructor',
                    '@mastra/core',
                    'portkey-ai',
                  ];
                  if (depNames.some((d) => LLM_PACKAGES.includes(d))) {
                    tui.store.addDiscoveredFeature(DiscoveredFeature.LLM);
                  }
                }
              } catch {
                // No package.json or parse error — skip feature discovery
              }

              // Signal detection is done — IntroScreen shows picker or results
              tui.store.setDetectionComplete();
            })();

            // Gate runWizard on the user reaching RunScreen — at that point
            // auth, data check, and any setup questions are all complete.
            const { Screen } = await import('./src/ui/tui/router.js');
            tui.store.onEnterScreen(Screen.Run, () =>
              tui.store.completeSetup(),
            );

            // Wait for auth and framework detection to finish concurrently.
            await Promise.all([authTask, detectionTask]);

            if (session.verbose || session.debug) {
              const { logToFile } = await import('./src/utils/debug.js');
              logToFile(
                `[verbose] detection    : ${
                  tui.store.session.integration ?? 'none'
                }`,
              );
              logToFile(
                `[verbose] framework    : ${
                  tui.store.session.detectedFrameworkLabel ?? 'unknown'
                }`,
              );
              logToFile(
                `[verbose] region       : ${
                  tui.store.session.region ?? 'not set'
                }`,
              );
            }

            // Blocks until onEnterScreen(Screen.Run) fires completeSetup().
            await tui.waitForSetup();

            // Before calling the AI agent, do a quick static check to see if
            // Amplitude is already installed in the project. If so, skip the
            // agent entirely and advance directly to MCP setup.
            const { detectAmplitudeInProject } = await import(
              './src/lib/detect-amplitude.js'
            );
            const localDetection = detectAmplitudeInProject(installDir);

            if (localDetection.confidence !== 'none') {
              const { logToFile: log } = await import('./src/utils/debug.js');
              log(
                `[bin] Amplitude already detected (${
                  localDetection.reason ?? 'unknown'
                }) — prompting on MCP screen (continue vs run wizard)`,
              );
              const { RunPhase, OutroKind } = await import(
                './src/lib/wizard-session.js'
              );
              tui.store.setAmplitudePreDetected();
              tui.store.setRunPhase(RunPhase.Completed);
              const runWizardAnyway =
                await tui.store.waitForPreDetectedChoice();
              if (runWizardAnyway) {
                log(
                  '[bin] user chose to run setup wizard despite pre-detection',
                );
                tui.store.resetForAgentAfterPreDetected();
                await runWizard(
                  options as Parameters<typeof runWizard>[0],
                  tui.store.session,
                );
              } else {
                tui.store.setOutroData({ kind: OutroKind.Success });
              }
            } else {
              await runWizard(
                options as Parameters<typeof runWizard>[0],
                tui.store.session,
              );
            }

            // Keep the outro screen visible — let process.exit() handle cleanup
          } catch (err) {
            // TUI unavailable (e.g., in test environment) — continue with default UI
            if (process.env.DEBUG || process.env.AMPLITUDE_WIZARD_DEBUG) {
              console.error('TUI init failed:', err);
            }
            await runWizard(options as Parameters<typeof runWizard>[0]);
          }
        })();
      }
    },
  )
  .command(
    'login',
    'Log in to your Amplitude account',
    (yargs) => {
      return yargs.options({
        zone: {
          describe: 'Amplitude data center zone (us or eu)',
          choices: ['us', 'eu'] as const,
          default: 'us' as const,
          type: 'string',
        },
      });
    },
    (argv) => {
      void (async () => {
        setUI(new LoggingUI());
        const { performAmplitudeAuth } = await import('./src/utils/oauth.js');
        const { fetchAmplitudeUser } = await import('./src/lib/api.js');
        const { storeToken } = await import('./src/utils/ampli-settings.js');
        const zone = argv.zone as 'us' | 'eu';

        try {
          const { getStoredUser, getStoredToken } = await import(
            './src/utils/ampli-settings.js'
          );
          // If a valid cached session exists, display the stored user without
          // re-fetching from the API (the cached idToken may be expired).
          const cachedToken = getStoredToken(undefined, zone);
          const cachedUser = cachedToken ? getStoredUser() : undefined;
          if (cachedUser && cachedUser.id !== 'pending') {
            console.log(
              chalk.green(
                `✔ Already logged in as ${cachedUser.firstName} ${cachedUser.lastName} <${cachedUser.email}>`,
              ),
            );
            if (cachedUser.zone !== 'us') {
              console.log(chalk.dim(`  Zone: ${cachedUser.zone}`));
            }
            process.exit(0);
          }

          const auth = await performAmplitudeAuth({ zone });
          const user = await fetchAmplitudeUser(auth.idToken, auth.zone);
          storeToken(
            {
              id: user.id,
              firstName: user.firstName,
              lastName: user.lastName,
              email: user.email,
              zone: auth.zone,
            },
            {
              accessToken: auth.accessToken,
              idToken: auth.idToken,
              refreshToken: auth.refreshToken,
              expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
            },
          );
          console.log(
            chalk.green(
              `✔ Logged in as ${user.firstName} ${user.lastName} <${user.email}>`,
            ),
          );
          if (user.orgs.length > 0) {
            console.log(
              chalk.dim(`  Org: ${user.orgs.map((o) => o.name).join(', ')}`),
            );
          }
          process.exit(0);
        } catch (e) {
          console.error(
            chalk.red(
              `Login failed: ${e instanceof Error ? e.message : String(e)}`,
            ),
          );
          process.exit(1);
        }
      })();
    },
  )
  .command(
    'logout',
    'Log out of your Amplitude account',

    () => {},
    (argv) => {
      void (async () => {
        const { getStoredUser, clearStoredCredentials } = await import(
          './src/utils/ampli-settings.js'
        );
        const { clearApiKey } = await import('./src/utils/api-key-store.js');
        const installDir =
          (argv.installDir as string | undefined) ?? process.cwd();
        const user = getStoredUser();
        try {
          clearStoredCredentials();
          clearApiKey(installDir);
          if (user) {
            console.log(chalk.green(`✔ Logged out ${user.email}`));
          } else {
            console.log(chalk.dim('No active session found.'));
          }
        } catch {
          console.log(chalk.dim('No active session found.'));
        }
        process.exit(0);
      })();
    },
  )
  .command(
    'whoami',
    'Show the currently logged-in Amplitude account',

    () => {},
    (_argv) => {
      void (async () => {
        const { getStoredUser, getStoredToken } = await import(
          './src/utils/ampli-settings.js'
        );
        const user = getStoredUser();
        const token = getStoredToken();
        if (user && token && user.id !== 'pending') {
          console.log(
            `Logged in as ${chalk.bold(
              user.firstName + ' ' + user.lastName,
            )} <${user.email}>`,
          );
          if (user.zone !== 'us') console.log(chalk.dim(`Zone: ${user.zone}`));
        } else {
          console.log(
            chalk.yellow(
              'Not logged in. Run `amplitude-wizard login` to authenticate.',
            ),
          );
        }
        process.exit(0);
      })();
    },
  )
  .command(
    'feedback',
    'Send product feedback',
    (yargs) => {
      return yargs.options({
        message: {
          alias: 'm',
          describe: 'Feedback message',
          type: 'string',
        },
      });
    },
    (argv) => {
      void (async () => {
        setUI(new LoggingUI());
        const fromFlag =
          typeof argv.message === 'string' ? argv.message.trim() : '';
        const argvRest = (argv._ as string[]).slice(1).join(' ').trim();
        const message = (fromFlag || argvRest).trim();
        if (!message) {
          getUI().log.error(
            'Usage: amplitude-wizard feedback <message>  or  feedback --message <message>',
          );
          process.exit(1);
          return;
        }
        try {
          const { trackWizardFeedback } = await import(
            './src/utils/track-wizard-feedback.js'
          );
          await trackWizardFeedback(message);
          console.log(chalk.green('✔ Thanks — your feedback was sent.'));
          process.exit(0);
        } catch (e) {
          console.error(
            chalk.red(
              `Feedback failed: ${e instanceof Error ? e.message : String(e)}`,
            ),
          );
          process.exit(1);
        }
      })();
    },
  )
  .command(
    'slack',
    'Set up Amplitude Slack integration',
    (y) => y,
    (_argv) => {
      void (async () => {
        // Dynamic imports may land named exports on `.default` under tsx
        // CJS/ESM interop. This helper normalises that.
        const cjs = <T>(mod: T & { default?: T }): T =>
          (mod.default ?? mod) as T;

        try {
          const { getStoredUser, getStoredToken } = cjs(
            await import('./src/utils/ampli-settings.js'),
          );
          const { readAmpliConfig } = cjs(
            await import('./src/lib/ampli-config.js'),
          );
          const { fetchSlackInstallUrl, fetchSlackConnectionStatus } = cjs(
            await import('./src/lib/api.js'),
          );
          const { OUTBOUND_URLS } = cjs(await import('./src/lib/constants.js'));
          const opn = (await import('opn')).default;

          const storedUser = getStoredUser();
          const zone = storedUser?.zone ?? 'us';
          const storedToken = getStoredToken(storedUser?.id, zone);
          // Thunder validates access_tokens via Hydra, not id_tokens.
          const accessToken = storedToken?.accessToken;

          // Read orgId from project-level ampli.json
          const ampliConfig = readAmpliConfig(process.cwd());
          const orgId = ampliConfig.ok ? ampliConfig.config.OrgId : undefined;

          if (!accessToken || !orgId) {
            setUI(new LoggingUI());
            getUI().log.info(
              'No Amplitude session found. Run `npx @amplitude/wizard` first to log in and set up your project.',
            );
            process.exit(1);
          }

          // Check if Slack is already connected before prompting install.
          const isConnected = await fetchSlackConnectionStatus(
            accessToken,
            zone,
            orgId,
          );
          if (isConnected) {
            setUI(new LoggingUI());
            getUI().log.info(
              'Slack is already connected to your Amplitude workspace.',
            );
            process.exit(0);
          }

          const settingsUrl = OUTBOUND_URLS.slackSettings(zone, orgId);
          let url = settingsUrl;

          // Try to get the direct Slack OAuth URL from Thunder.
          const directUrl = await fetchSlackInstallUrl(
            accessToken,
            zone,
            orgId,
            settingsUrl,
          );
          if (directUrl) url = directUrl;

          setUI(new LoggingUI());
          getUI().log.info(`Opening Slack integration: ${url}`);
          await opn(url, { wait: false });
        } catch {
          setUI(new LoggingUI());
          const { getCloudUrlFromRegion } = cjs(
            await import('./src/utils/urls.js'),
          );
          const opn = (await import('opn')).default;
          const url = `${getCloudUrlFromRegion(
            'us',
          )}/analytics/settings/profile`;
          getUI().log.info(
            `Opening Amplitude Settings to connect Slack: ${url}`,
          );
          await opn(url, { wait: false });
        }
      })();
    },
  )
  .command(
    'region',
    'Switch data-center region (US or EU)',
    (y) => y,
    (argv) => {
      void (async () => {
        try {
          const { startTUI } = await import('./src/ui/tui/start-tui.js');
          const { buildSession } = await import('./src/lib/wizard-session.js');
          const { Flow } = await import('./src/ui/tui/router.js');
          const { getStoredUser, getStoredToken, updateStoredUserZone } =
            await import('./src/utils/ampli-settings.js');
          const { getHostFromRegion } = await import('./src/utils/urls.js');

          const session = buildSession({
            debug:
              typeof argv['debug'] === 'boolean' ? argv['debug'] : undefined,
          });

          // Show the "Switch data-center region" variant of RegionSelectScreen.
          session.regionForced = true;

          // Pre-populate credentials from ~/.ampli.json so the screen has context.
          const storedUser = getStoredUser();
          const zone = storedUser?.zone ?? 'us';
          const storedToken = getStoredToken(storedUser?.id, zone);
          if (storedToken) {
            session.credentials = {
              accessToken: storedToken.accessToken,
              projectApiKey: '',
              host: getHostFromRegion(zone),
              projectId: 0,
            };
          }

          const tui = startTUI(WIZARD_VERSION, Flow.RegionSelect, session);

          // Wait for the user to pick a region, then persist and exit.
          const pickedRegion = await new Promise<string>((resolve) => {
            const unsub = tui.store.subscribe(() => {
              const s = tui.store.session;
              if (s.region !== null && !s.regionForced) {
                unsub();
                resolve(s.region);
              }
            });
          });

          const updated = updateStoredUserZone(pickedRegion as 'us' | 'eu');
          if (updated) {
            console.log(
              chalk.green(
                `\n✔ Region updated to ${pickedRegion.toUpperCase()}`,
              ),
            );
          } else {
            console.log(
              chalk.dim(
                `\nRegion set to ${pickedRegion.toUpperCase()}. Run \`amplitude-wizard login\` to authenticate.`,
              ),
            );
          }
          process.exit(0);
        } catch {
          setUI(new LoggingUI());
          getUI().log.error(
            'Could not start region picker. Use --zone with `amplitude-wizard login` to set your region.',
          );
          process.exit(1);
        }
      })();
    },
  )
  .command('mcp <command>', 'MCP server management commands', (yargs) => {
    return yargs
      .command(
        'add',
        'Install Amplitude MCP server to supported clients',
        (yargs) => {
          return yargs.options({
            local: {
              default: false,
              describe:
                'Add local development MCP server (http://localhost:8787)',
              type: 'boolean',
            },
          });
        },
        (argv) => {
          const options = { ...argv };
          void (async () => {
            try {
              const { startTUI } = await import('./src/ui/tui/start-tui.js');
              const { buildSession } = await import(
                './src/lib/wizard-session.js'
              );

              const { Flow } = await import('./src/ui/tui/router.js');
              const tui = startTUI(WIZARD_VERSION, Flow.McpAdd);
              const session = buildSession({
                debug: options.debug,
                localMcp: options.local,
              });
              tui.store.session = session;
            } catch {
              // TUI unavailable — fallback to logging
              setUI(new LoggingUI());
              const { addMCPServerToClientsStep } = await import(
                './src/steps/add-mcp-server-to-clients/index.js'
              );
              await addMCPServerToClientsStep({
                local: options.local,
              });
            }
          })();
        },
      )
      .command(
        'remove',
        'Remove Amplitude MCP server from supported clients',
        (yargs) => {
          return yargs.options({
            local: {
              default: false,
              describe:
                'Remove local development MCP server (http://localhost:8787)',
              type: 'boolean',
            },
          });
        },
        (argv) => {
          const options = { ...argv };
          void (async () => {
            try {
              const { startTUI } = await import('./src/ui/tui/start-tui.js');
              const { buildSession } = await import(
                './src/lib/wizard-session.js'
              );

              const { Flow } = await import('./src/ui/tui/router.js');
              const tui = startTUI(WIZARD_VERSION, Flow.McpRemove);
              const session = buildSession({
                debug: options.debug,
                localMcp: options.local,
              });
              tui.store.session = session;
            } catch {
              // TUI unavailable — fallback to logging
              setUI(new LoggingUI());
              const { removeMCPServerFromClientsStep } = await import(
                './src/steps/add-mcp-server-to-clients/index.js'
              );
              await removeMCPServerFromClientsStep({
                local: options.local,
              });
            }
          })();
        },
      )
      .demandCommand(1, 'You must specify a subcommand (add or remove)')
      .help();
  })
  .command(
    'completion',
    'Print shell completion script\n(add `eval "$(amplitude-wizard completion)"` to ~/.zshrc or ~/.bashrc)',
    () => {},
    () => {
      const script = (process.env.SHELL ?? '').endsWith('zsh')
        ? ZSH_COMPLETION_SCRIPT
        : BASH_COMPLETION_SCRIPT;
      process.stdout.write(script + '\n');
      process.exit(0);
    },
  )
  .help()
  .alias('help', 'h')
  .version()
  .alias('version', 'v')
  .wrap(process.stdout.isTTY ? yargs.terminalWidth() : 80).argv;
