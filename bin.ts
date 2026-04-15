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

import { isNonInteractiveEnvironment } from './src/utils/environment';
import { getUI, setUI } from './src/ui';
import { LoggingUI } from './src/ui/logging-ui';
import {
  ZSH_COMPLETION_SCRIPT,
  BASH_COMPLETION_SCRIPT,
} from './src/utils/shell-completions';
import { ExitCode } from './src/lib/exit-codes';

// Dynamic import to avoid preloading wizard-session.ts as CJS, which
// prevents the TUI's ESM dynamic imports from resolving named exports.
const lazyRunWizard = async (
  ...args: Parameters<typeof import('./src/run')['runWizard']>
) => {
  const { runWizard } = await import('./src/run.js');
  return runWizard(...args);
};

/**
 * Build a WizardSession from CLI argv, avoiding the repeated 12-field literal.
 */
const buildSessionFromOptions = async (
  options: Record<string, unknown>,
  overrides?: { ci?: boolean },
) => {
  const { buildSession } = await import('./src/lib/wizard-session.js');
  return buildSession({
    debug: options.debug as boolean | undefined,
    verbose: options.verbose as boolean | undefined,
    forceInstall: options.forceInstall as boolean | undefined,
    installDir: options.installDir as string | undefined,
    ci: overrides?.ci ?? false,
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
};

/**
 * Shared credential resolution for non-interactive modes (agent + CI).
 * Handles --api-key shortcut, OAuth token refresh, and pendingOrgs.
 *
 * @param mode - 'agent' prompts via AgentUI, 'ci' auto-selects first env
 */
const resolveNonInteractiveCredentials = async (
  session: import('./src/lib/wizard-session').WizardSession,
  options: Record<string, unknown>,
  mode: 'agent' | 'ci',
  agentUI?: import('./src/ui/agent-ui').AgentUI,
) => {
  // If --api-key was provided, skip OAuth entirely
  if (session.apiKey) {
    const { DEFAULT_HOST_URL } = await import('./src/lib/constants.js');
    session.credentials = {
      accessToken: session.apiKey,
      projectApiKey: session.apiKey,
      host: DEFAULT_HOST_URL,
      projectId: session.projectId ?? 0,
    };
    session.projectHasData = false;
    return;
  }

  // Resolve credentials from stored OAuth tokens
  const { resolveCredentials, resolveEnvironmentSelection } = await import(
    './src/lib/credential-resolution.js'
  );
  await resolveCredentials(session, {
    requireOrgId: false,
    org: options.org as string | undefined,
    env: options.env as string | undefined,
  });

  // Handle multiple environments
  if (session.pendingOrgs && !session.credentials) {
    if (mode === 'ci') {
      // CI mode: auto-select first environment with an API key
      for (const org of session.pendingOrgs) {
        for (const ws of org.workspaces) {
          const env = (ws.environments ?? [])
            .filter((e) => e.app?.apiKey)
            .sort((a, b) => a.rank - b.rank)[0];
          if (env) {
            await resolveEnvironmentSelection(session, {
              orgId: org.id,
              workspaceId: ws.id,
              env: env.name,
            });
            getUI().log.info(
              `Resolved Amplitude API key non-interactively (CI mode): ${org.name} / ${ws.name} / ${env.name}`,
            );
            break;
          }
        }
        if (session.credentials) break;
      }
    } else if (agentUI) {
      // Agent mode: list envs and prompt via stdin
      const envList: string[] = [];
      for (const org of session.pendingOrgs) {
        for (const ws of org.workspaces) {
          for (const env of ws.environments ?? []) {
            if (env.app?.apiKey) {
              envList.push(`  --env "${env.name}"  (${org.name} / ${ws.name})`);
            }
          }
        }
      }
      getUI().log.info(
        `Multiple environments found. Re-run with one of:\n${envList.join(
          '\n',
        )}`,
      );
      const selection = await agentUI.promptEnvironmentSelection(
        session.pendingOrgs,
      );
      const resolved = await resolveEnvironmentSelection(session, selection);
      if (!resolved) {
        process.exit(ExitCode.AUTH_REQUIRED);
      }
    }
  }

  // If we still don't have credentials, auth is required
  if (!session.credentials) {
    if (mode === 'agent') {
      getUI().log.error(
        'Could not resolve credentials. ' +
          'Please log in first by running: amplitude-wizard login',
      );
      process.exit(ExitCode.AUTH_REQUIRED);
    }
    // CI mode falls through — runWizard will handle missing credentials
  }

  // Log what was resolved so the caller can see it
  if (mode === 'agent' && session.credentials) {
    const parts = [
      session.selectedOrgName,
      session.selectedWorkspaceName,
      session.selectedProjectName,
    ].filter(Boolean);
    if (parts.length > 0) {
      getUI().log.info(`Using: ${parts.join(' / ')}`);
    }
  }
};

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
    org: {
      describe:
        'Amplitude org name to use (for multi-org accounts)\nenv: AMPLITUDE_WIZARD_ORG',
      type: 'string',
    },
    env: {
      describe:
        'Environment name to use (e.g. "Production", "Development")\nenv: AMPLITUDE_WIZARD_ENV',
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
        agent: {
          default: false,
          describe:
            'Run in agent mode with structured JSON output\nenv: AMPLITUDE_WIZARD_AGENT',
          type: 'boolean',
        },
        yes: {
          alias: 'y',
          default: false,
          describe: 'Skip all prompts and use defaults (same as --ci)',
          type: 'boolean',
        },
        classic: {
          default: false,
          describe:
            'Use the classic prompt-based UI instead of the rich TUI\nenv: AMPLITUDE_WIZARD_CLASSIC',
          type: 'boolean',
        },
      });
    },
    (argv) => {
      const options = { ...argv };

      // CI mode validation and TTY check
      if (
        options.agent ||
        process.env.AMPLITUDE_WIZARD_AGENT === '1' ||
        (!options.ci &&
          !options.yes &&
          !options.classic &&
          process.env.AMPLITUDE_WIZARD_CLASSIC !== '1' &&
          isNonInteractiveEnvironment())
      ) {
        // Agent mode (explicit --agent or auto-detected non-TTY)
        if (!options.agent) options.agent = true;
        void (async () => {
          const { AgentUI } = await import('./src/ui/agent-ui.js');
          const agentUI = new AgentUI();
          setUI(agentUI);
          if (!options.installDir) options.installDir = process.cwd();

          const session = await buildSessionFromOptions(options);
          await resolveNonInteractiveCredentials(
            session,
            options,
            'agent',
            agentUI,
          );
          await lazyRunWizard(
            options as Parameters<typeof lazyRunWizard>[0],
            session,
          );
        })();
      } else if (options.ci || options.yes) {
        // CI mode: no prompts, auto-select first environment
        setUI(new LoggingUI());
        if (!options.installDir) options.installDir = process.cwd();

        void (async () => {
          const session = await buildSessionFromOptions(options, { ci: true });
          await resolveNonInteractiveCredentials(session, options, 'ci');
          await lazyRunWizard(
            options as Parameters<typeof lazyRunWizard>[0],
            session,
          );
        })();
      } else if (
        options.classic ||
        process.env.AMPLITUDE_WIZARD_CLASSIC === '1'
      ) {
        // Classic mode: interactive prompts without the rich TUI
        void lazyRunWizard(options as Parameters<typeof lazyRunWizard>[0]);
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
            const tui = startTUI(WIZARD_VERSION);

            // Build session from CLI args and attach to store
            const session = await buildSessionFromOptions(options);

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
              // Pre-populate region + credentials from stored OAuth tokens.
              const { logToFile } = await import('./src/utils/debug.js');

              // Check for crash-recovery checkpoint
              const { loadCheckpoint } = await import(
                './src/lib/session-checkpoint.js'
              );
              const checkpoint = loadCheckpoint(session.installDir);
              if (checkpoint) {
                Object.assign(session, checkpoint);
                session.introConcluded = false;
                session._restoredFromCheckpoint = true;
                logToFile(
                  '[bin] restored session from crash-recovery checkpoint',
                );
              }

              // Resolve credentials using shared logic (token refresh,
              // env auto-select, pendingOrgs population)
              const { resolveCredentials } = await import(
                './src/lib/credential-resolution.js'
              );
              await resolveCredentials(session);

              // Resolve org/workspace display names so /whoami shows them.
              // Fire-and-forget so it doesn't block startup.
              if (session.region && session.selectedOrgId) {
                const { getStoredUser, getStoredToken } = await import(
                  './src/utils/ampli-settings.js'
                );
                const { fetchAmplitudeUser } = await import('./src/lib/api.js');
                const storedUser = getStoredUser();
                const realUser =
                  storedUser && storedUser.id !== 'pending' ? storedUser : null;
                const zone = session.region;
                const storedToken = realUser
                  ? getStoredToken(realUser.id, realUser.zone)
                  : getStoredToken(undefined, zone);
                if (storedToken) {
                  fetchAmplitudeUser(storedToken.idToken, zone)
                    .then((userInfo) => {
                      let changed = false;
                      if (userInfo.email && !session.userEmail) {
                        session.userEmail = userInfo.email;
                        changed = true;
                      }
                      if (session.selectedOrgId) {
                        const org = userInfo.orgs.find(
                          (o) => o.id === session.selectedOrgId,
                        );
                        if (org) {
                          session.selectedOrgName = org.name;
                          changed = true;
                          const ws = session.selectedWorkspaceId
                            ? org.workspaces.find(
                                (w) => w.id === session.selectedWorkspaceId,
                              )
                            : undefined;
                          if (ws) {
                            session.selectedWorkspaceName = ws.name;
                          }
                        }
                      }
                      if (changed && tui.store.session === session) {
                        tui.store.emitChange();
                      }
                    })
                    .catch(() => {
                      // Non-fatal — /whoami will just show (none)
                    });
                }
              }
            }

            tui.store.session = session;

            // Load event plan from a previous run (if it exists) so the
            // Events tab is available immediately on returning runs.
            try {
              const fs = await import('fs');
              const evtPath = resolve(
                session.installDir,
                '.amplitude-events.json',
              );
              const evtContent = fs.readFileSync(evtPath, 'utf-8');
              const evtSchema = z.array(
                z.object({
                  name: z.string().optional(),
                  event: z.string().optional(),
                  eventName: z.string().optional(),
                  description: z.string().optional(),
                  eventDescriptionAndReasoning: z.string().optional(),
                }),
              );
              const evtResult = evtSchema.safeParse(JSON.parse(evtContent));
              if (evtResult.success && evtResult.data.length > 0) {
                tui.store.setEventPlan(
                  evtResult.data.map((e) => ({
                    name: e.name ?? e.event ?? e.eventName ?? '',
                    description:
                      e.description ?? e.eventDescriptionAndReasoning ?? '',
                  })),
                );
              }
            } catch {
              // No event plan file yet — that's fine
            }

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
            const { detectAllFrameworks } = await import('./src/run.js');
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

                // Wait for the user to dismiss the welcome screen AND pick a
                // region before opening the OAuth URL. This ensures the logo
                // and intro are visible before the browser opens.
                await new Promise<void>((resolve) => {
                  if (
                    tui.store.session.introConcluded &&
                    tui.store.session.region !== null
                  ) {
                    resolve();
                    return;
                  }
                  const unsub = tui.store.subscribe(() => {
                    if (
                      tui.store.session.introConcluded &&
                      tui.store.session.region !== null
                    ) {
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

                let userInfo;
                try {
                  userInfo = await fetchAmplitudeUser(
                    auth.idToken,
                    cloudRegion,
                  );
                } catch {
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

                // Populate user email for /whoami display
                session.userEmail = userInfo.email;

                // Signal AuthScreen — triggers org/workspace/API key pickers
                tui.store.setOAuthComplete({
                  accessToken: auth.accessToken,
                  idToken: auth.idToken,
                  cloudRegion,
                  orgs: userInfo.orgs,
                });
              } catch (err) {
                // Auth failure is non-fatal here — agent-runner will retry/handle it
                if (process.env.DEBUG || process.env.AMPLITUDE_WIZARD_DEBUG) {
                  console.error('OAuth setup error:', err);
                }
              }
            })();

            // ── Framework detection ────────────────────────────────
            // Runs concurrently with auth while AuthScreen shows.
            // Each detector has its own per-framework timeout internally,
            // so no outer timeout is needed.
            // IMPORTANT: setDetectionComplete() MUST fire in all code paths
            // or the user gets stuck on the detecting screen forever.
            const detectionTask = (async () => {
              try {
                const results = await detectAllFrameworks(installDir);

                // Store full results on session for diagnostics
                session.detectionResults = results;

                const detectedIntegration = results.find(
                  (r) => r.detected,
                )?.integration;

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
              } finally {
                // Signal detection is done — IntroScreen shows picker or results.
                // This MUST fire even if detection or feature discovery throws,
                // otherwise the user gets stuck on the detecting screen forever.
                tui.store.setDetectionComplete();
              }
            })();

            // Gate runWizard on the user reaching RunScreen — at that point
            // auth, data check, and any setup questions are all complete.
            const { Screen } = await import('./src/ui/tui/router.js');
            tui.store.onEnterScreen(Screen.Run, () =>
              tui.store.completeSetup(),
            );

            // Session checkpointing — save at key transitions so crash
            // recovery can skip already-completed steps.
            const { saveCheckpoint, clearCheckpoint } = await import(
              './src/lib/session-checkpoint.js'
            );
            // After auth completes (most expensive step to repeat)
            tui.store.onEnterScreen(Screen.DataSetup, () => {
              saveCheckpoint(tui.store.session);
            });
            // Before agent starts (captures all setup state)
            tui.store.onEnterScreen(Screen.Run, () => {
              saveCheckpoint(tui.store.session);
            });
            // Clear checkpoint only on successful completion — error/cancel
            // should preserve the checkpoint so users can resume next run.
            tui.store.onEnterScreen(Screen.Outro, () => {
              if (tui.store.session.outroData?.kind === 'success') {
                clearCheckpoint(tui.store.session.installDir);
              }
            });

            // Save checkpoint on unexpected termination (Ctrl+C).
            // First Ctrl+C saves checkpoint and exits promptly.
            // Second Ctrl+C within the grace window force-kills immediately.
            let sigintReceived = false;
            process.on('SIGINT', () => {
              if (sigintReceived) {
                // Second Ctrl+C — force-kill without waiting
                process.exit(130);
              }
              sigintReceived = true;

              // Force-kill after 1 second if checkpoint save hangs
              const forceTimer = setTimeout(() => process.exit(130), 1_000);
              // Unref so it doesn't keep the event loop alive
              if (forceTimer.unref) forceTimer.unref();

              try {
                saveCheckpoint(tui.store.session);
              } catch {
                // Best-effort — don't block exit
              }
              process.exit(130);
            });

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
                await lazyRunWizard(
                  options as Parameters<typeof lazyRunWizard>[0],
                  tui.store.session,
                );
              } else {
                tui.store.setOutroData({ kind: OutroKind.Success });
              }
            } else {
              await lazyRunWizard(
                options as Parameters<typeof lazyRunWizard>[0],
                tui.store.session,
              );
            }

            // Keep the outro screen visible — let process.exit() handle cleanup
          } catch (err) {
            // TUI unavailable (e.g., in test environment) — continue with default UI
            if (process.env.DEBUG || process.env.AMPLITUDE_WIZARD_DEBUG) {
              console.error('TUI init failed:', err);
            }
            await lazyRunWizard(options as Parameters<typeof lazyRunWizard>[0]);
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
        const { clearCheckpoint } = await import(
          './src/lib/session-checkpoint.js'
        );
        const installDir =
          (argv.installDir as string | undefined) ?? process.cwd();
        const user = getStoredUser();
        try {
          clearStoredCredentials();
          clearApiKey(installDir);
          clearCheckpoint(installDir);
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
  .example('$0', 'Run the interactive setup wizard')
  .example('$0 --ci --api-key <key> --install-dir .', 'Run in CI mode')
  .example(
    '$0 --agent --install-dir .',
    'Run with structured JSON output for automation',
  )
  .epilogue(
    'Docs: https://amplitude.com/docs/wizard\nFeedback: wizard@amplitude.com',
  )
  .recommendCommands()
  .help()
  .alias('help', 'h')
  .version()
  .alias('version', 'v')
  .wrap(process.stdout.isTTY ? yargs.terminalWidth() : 80).argv;
