#!/usr/bin/env node
import { satisfies } from 'semver';
import { red } from './src/utils/logging';
import { config as loadDotenv } from 'dotenv';
loadDotenv();

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import chalk from 'chalk';

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';

const WIZARD_VERSION = (() => {
  // npm/pnpm set this when running via package scripts
  if (process.env.npm_package_version) return process.env.npm_package_version;
  // Fallback: read package.json relative to this file
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(dirname(__filename), '..', 'package.json'), 'utf-8'),
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

if (process.env.NODE_ENV === 'test') {
  void (async () => {
    try {
      const { server } = await import('./e2e-tests/mocks/server.js');
      server.listen({
        onUnhandledRequest: 'bypass',
      });
    } catch (error) {
      // Mock server import failed - this can happen during non-E2E tests
    }
  })();
}

yargs(hideBin(process.argv))
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
        if (!options.apiKey) {
          getUI().intro(chalk.inverse(`Amplitude Wizard`));
          getUI().log.error(
            'CI mode requires --api-key (personal API key phx_xxx)',
          );
          process.exit(1);
        }
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
            '  npx @amplitude/wizard --ci --api-key <your-key> --install-dir .',
        );
        process.exit(1);
      } else {
        // Interactive TTY: launch the Ink TUI
        void (async () => {
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
            tui.store.session = session;

            // If --api-key was provided, skip the OAuth/TUI auth flow entirely.
            if (session.apiKey) {
              const { DEFAULT_HOST_URL } = await import(
                './src/lib/constants.js'
              );
              tui.store.setCredentials({
                accessToken: session.apiKey,
                projectApiKey: session.apiKey,
                host: DEFAULT_HOST_URL,
                projectId: session.projectId ?? 0,
              });
              tui.store.setProjectHasData(false);
            }

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

                let userInfo;
                try {
                  userInfo = await fetchAmplitudeUser(auth.idToken, cloudRegion);
                } catch {
                  // Token may be expired — re-open the browser for a fresh login
                  tui.store.setLoginUrl(null);
                  auth = await performAmplitudeAuth({ zone, forceFresh: true });
                  userInfo = await fetchAmplitudeUser(auth.idToken, cloudRegion);
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
                tui.store.setOAuthComplete({
                  idToken: auth.idToken,
                  cloudRegion,
                  orgs: userInfo.orgs,
                });
              } catch (err) {
                // Auth failure is non-fatal here — agent-runner will retry/handle it
                if (process.env.DEBUG || process.env.AMPLITUDE_WIZARD_DEBUG) {
                  console.error('OAuth setup error:', err); // eslint-disable-line no-console
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
              }

              // Feature discovery — deterministic scan of package.json deps
              try {
                const { readFileSync } = await import('fs');
                const pkgPath = require('path').join(
                  installDir,
                  'package.json',
                );
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
              } catch {
                // No package.json or parse error — skip feature discovery
              }

              // Signal detection is done — IntroScreen shows picker or results
              tui.store.setDetectionComplete();
            })();

            // Wait for auth to expose org pickers, then for the user to
            // complete account setup (credentials set by AuthScreen), then
            // for IntroScreen confirmation.
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

            await tui.waitForSetup();

            await runWizard(
              options as Parameters<typeof runWizard>[0],
              tui.store.session,
            );

            // Keep the outro screen visible — let process.exit() handle cleanup
          } catch (err) {
            // TUI unavailable (e.g., in test environment) — continue with default UI
            if (process.env.DEBUG || process.env.AMPLITUDE_WIZARD_DEBUG) {
              console.error('TUI init failed:', err); // eslint-disable-line no-console
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
            ); // eslint-disable-line no-console
            if (cachedUser.zone !== 'us') {
              console.log(chalk.dim(`  Zone: ${cachedUser.zone}`)); // eslint-disable-line no-console
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
          ); // eslint-disable-line no-console
          if (user.orgs.length > 0) {
            console.log(
              chalk.dim(`  Org: ${user.orgs.map((o) => o.name).join(', ')}`),
            ); // eslint-disable-line no-console
          }
          process.exit(0);
        } catch (e) {
          console.error(
            chalk.red(
              `Login failed: ${e instanceof Error ? e.message : String(e)}`,
            ),
          ); // eslint-disable-line no-console
          process.exit(1);
        }
      })();
    },
  )
  .command(
    'logout',
    'Log out of your Amplitude account',
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    () => {},
    (_argv) => {
      void (async () => {
        const { getStoredUser } = await import('./src/utils/ampli-settings.js');
        const fs = await import('node:fs');
        const os = await import('node:os');
        const path = await import('node:path');
        const configPath = path.join(os.homedir(), 'ampli.json');
        const user = getStoredUser();
        try {
          fs.writeFileSync(configPath, '{}', 'utf-8');
          if (user) {
            console.log(chalk.green(`✔ Logged out ${user.email}`)); // eslint-disable-line no-console
          } else {
            console.log(chalk.dim('No active session found.')); // eslint-disable-line no-console
          }
        } catch {
          console.log(chalk.dim('No active session found.')); // eslint-disable-line no-console
        }
        process.exit(0);
      })();
    },
  )
  .command(
    'whoami',
    'Show the currently logged-in Amplitude account',
    // eslint-disable-next-line @typescript-eslint/no-empty-function
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
          ); // eslint-disable-line no-console
          if (user.zone !== 'us') console.log(chalk.dim(`Zone: ${user.zone}`)); // eslint-disable-line no-console
        } else {
          console.log(
            chalk.yellow(
              'Not logged in. Run `amplitude-wizard login` to authenticate.',
            ),
          ); // eslint-disable-line no-console
        }
        process.exit(0);
      })();
    },
  )
  .command(
    'slack',
    'Set up Amplitude Slack integration',
    (y) => y,
    (argv) => {
      void (async () => {
        try {
          const { startTUI } = await import('./src/ui/tui/start-tui.js');
          const { buildSession } = await import('./src/lib/wizard-session.js');
          const { Flow } = await import('./src/ui/tui/router.js');
          const { getStoredUser, getStoredToken } = await import('./src/utils/ampli-settings.js');
          const { getHostFromRegion } = await import('./src/utils/urls.js');

          const session = buildSession({
            debug: typeof argv['debug'] === 'boolean' ? argv['debug'] : undefined,
          });

          // Pre-populate credentials from ~/.ampli.json so SlackScreen can
          // resolve the org name via fetchAmplitudeUser.
          const storedUser = getStoredUser();
          const zone = storedUser?.zone ?? 'us';
          const storedToken = getStoredToken(storedUser?.id, zone);
          if (storedToken) {
            session.region = zone;
            session.credentials = {
              accessToken: storedToken.idToken,
              projectApiKey: '',
              host: getHostFromRegion(zone),
              projectId: 0,
            };
          }

          // Pass the pre-populated session so it's available before the first render.
          startTUI(WIZARD_VERSION as string, Flow.SlackSetup, session);
        } catch {
          setUI(new LoggingUI());
          const { getCloudUrlFromRegion } = await import('./src/utils/urls.js');
          const opn = (await import('opn')).default;
          const url = `${getCloudUrlFromRegion('us')}/settings/profile`;
          getUI().log.info(
            `Opening Amplitude Settings to connect Slack: ${url}`,
          );
          await opn(url, { wait: false });
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
  .help()
  .alias('help', 'h')
  .version()
  .alias('version', 'v')
  .wrap(process.stdout.isTTY ? yargs.terminalWidth() : 80).argv;
