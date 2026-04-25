import type { CommandModule } from 'yargs';
import { resolve } from 'path';
import { isNonInteractiveEnvironment } from '../utils/environment';
import {
  getUI,
  setUI,
  LoggingUI,
  analytics,
  buildSessionFromOptions,
  resolveNonInteractiveCredentials,
  runDirectSignupIfRequested,
  lazyRunWizard,
} from './helpers';
import { WIZARD_VERSION } from './context';

export const defaultCommand: CommandModule = {
  command: '$0',
  describe: 'Run the Amplitude setup wizard',
  builder: (yargs) =>
    yargs.options({
      region: {
        // Required for --signup in non-TUI modes: the backend does
        // not route across regions, so the client must POST to the
        // correct provisioning endpoint (us or eu). In the TUI this
        // is covered by the RegionSelect screen; agent/CI/classic
        // have no prompt, so this flag is the only way to signal
        // regional intent on a first-time signup. When provided in
        // TUI mode, pre-populates the region and skips RegionSelect.
        // `--zone` is accepted as an alias for consistency with the
        // `wizard login` subcommand.
        describe: 'data center region for --signup in non-interactive modes',
        choices: ['us', 'eu'] as const,
        type: 'string',
        alias: 'zone',
      },
      'force-install': {
        default: false,
        describe: 'install packages even if dependency checks fail',
        type: 'boolean',
      },
      'install-dir': {
        describe: 'project directory to instrument',
        type: 'string',
      },
      integration: {
        describe: 'framework to set up (skips auto-detection)',
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
        describe: 'show a framework picker instead of auto-detecting',
        type: 'boolean',
      },
      benchmark: {
        default: false,
        describe: 'collect performance metrics during the run',
        type: 'boolean',
      },
      agent: {
        default: false,
        describe: 'emit structured NDJSON output for automation',
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
        describe: 'use the classic prompt-based UI',
        type: 'boolean',
      },
    }),
  handler: (argv) => {
    const options = { ...argv };

    // --env is redundant with --app-id (each Amplitude env has its own
    // app.id, so the numeric app-id already identifies the env). Keep the
    // flag parseable for legacy scripts, but nudge callers toward --app-id.
    // Surfaced via stderr for interactive/CI; agent mode re-emits it as a
    // structured NDJSON log event once AgentUI exists.
    const envDeprecationWarning = options.env
      ? '[deprecation] --env is redundant with --app-id — prefer ' +
        '--app-id <id> (globally unique, identifies the env directly). ' +
        '--env will be removed in a future release.'
      : null;
    const willRunAsAgent =
      options.agent || process.env.AMPLITUDE_WIZARD_AGENT === '1';
    if (envDeprecationWarning && !willRunAsAgent) {
      process.stderr.write(`${envDeprecationWarning}\n`);
    }

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
        const { AgentUI } = await import('../ui/agent-ui.js');
        const agentUI = new AgentUI();
        setUI(agentUI);
        if (!options.installDir) options.installDir = process.cwd();

        // Surface the --env deprecation warning as a structured log event
        // so orchestrators can parse it (raw stderr would mix with NDJSON).
        if (envDeprecationWarning) {
          agentUI.log.warn(envDeprecationWarning);
        }

        const session = await buildSessionFromOptions(options);
        session.agent = true;

        // Attempt direct signup before falling through to cached-token
        // resolution. Agent mode has no browser, so a null result continues
        // to resolveNonInteractiveCredentials, which handles cached tokens
        // or exits cleanly with AUTH_REQUIRED.
        await runDirectSignupIfRequested(session, 'cached-token resolution');

        await resolveNonInteractiveCredentials(
          session,
          options,
          'agent',
          agentUI,
        );
        await lazyRunWizard(
          options as Parameters<typeof lazyRunWizard>[0],
          session,
          () => session.additionalFeatureQueue,
        );
      })();
    } else if (options.ci || options.yes) {
      // CI mode: no prompts, auto-select first environment
      setUI(new LoggingUI());
      if (!options.installDir) options.installDir = process.cwd();

      void (async () => {
        const session = await buildSessionFromOptions(options, { ci: true });

        // Attempt direct signup before falling through to cached-token
        // resolution. CI mode has no browser, so a null result continues to
        // resolveNonInteractiveCredentials, which handles cached tokens or
        // exits cleanly with AUTH_REQUIRED.
        await runDirectSignupIfRequested(session, 'cached-token resolution');

        await resolveNonInteractiveCredentials(session, options, 'ci');
        await lazyRunWizard(
          options as Parameters<typeof lazyRunWizard>[0],
          session,
          () => session.additionalFeatureQueue,
        );
      })();
    } else if (
      options.classic ||
      process.env.AMPLITUDE_WIZARD_CLASSIC === '1'
    ) {
      // Classic mode: interactive prompts without the rich TUI
      void (async () => {
        const session = await buildSessionFromOptions(options);

        // Attempt direct signup before falling through to OAuth browser
        // flow. On success, run resolveCredentials so agent-runner's
        // !session.credentials guard skips the OAuth call. On null/failure,
        // classic mode proceeds normally — getOrAskForProjectData calls
        // performAmplitudeAuth, which opens a browser (valid for classic).
        //
        // requireOrgId: false — classic has no AuthScreen to recover from
        // the TUI-only safety check that clears credentials when no org is
        // selected. Without this, a successful signup would get silently
        // cleared and the browser would open anyway, defeating the point.
        await runDirectSignupIfRequested(session, 'OAuth', async () => {
          const { resolveCredentials } = await import(
            '../lib/credential-resolution.js'
          );
          await resolveCredentials(session, { requireOrgId: false });
        });

        await lazyRunWizard(
          options as Parameters<typeof lazyRunWizard>[0],
          session,
        );
      })();
    } else {
      // Interactive TTY: launch the Ink TUI
      void (async () => {
        try {
          const { startTUI } = await import('../ui/tui/start-tui.js');
          const tui = startTUI(WIZARD_VERSION);

          // Install the SIGINT handler IMMEDIATELY after starting the TUI.
          // This handler covers external `kill -INT <pid>` signals. When
          // the user presses Ctrl+C in the TUI, CtrlCHandler (Ink useInput)
          // owns that flow instead — Ink puts stdin in raw mode, so Ctrl+C
          // is delivered as a keypress, not SIGINT.
          //
          // Import the shared helper eagerly so it's available when SIGINT
          // fires — placing this after startTUI but before registering the
          // handler avoids the TDZ issue that would occur if we referenced
          // a `const` binding from a later dynamic import.
          const { performGracefulExit } = await import(
            '../lib/graceful-exit.js'
          );
          let sigintReceived = false;
          process.on('SIGINT', () => {
            if (sigintReceived) {
              process.exit(130);
            }
            sigintReceived = true;

            performGracefulExit({
              session: tui.store.session,
              setCommandFeedback: (msg, ms) =>
                tui.store.setCommandFeedback(msg, ms),
            });
          });

          // Build session from CLI args and attach to store
          const session = await buildSessionFromOptions(options);

          // If --api-key was provided, skip the OAuth/TUI auth flow entirely.
          if (session.apiKey) {
            const { DEFAULT_HOST_URL } = await import('../lib/constants.js');
            session.credentials = {
              accessToken: session.apiKey,
              projectApiKey: session.apiKey,
              host: DEFAULT_HOST_URL,
              appId: session.appId ?? 0,
            };
            session.projectHasData = false;
          } else {
            // Pre-populate region + credentials from stored OAuth tokens.
            const { logToFile } = await import('../utils/debug.js');

            // Check for crash-recovery checkpoint
            const { loadCheckpoint } = await import(
              '../lib/session-checkpoint.js'
            );
            const checkpoint = await loadCheckpoint(session.installDir);
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
              '../lib/credential-resolution.js'
            );
            await resolveCredentials(session);

            // Resolve org/workspace display names so /whoami shows them.
            // Also extracts the numeric analytics project ID for MCP event detection.
            // Fire-and-forget so it doesn't block startup.
            // Hydrate org/workspace display names after credential
            // resolution succeeds. Gate on credentials (not region) because
            // resolveCredentials no longer cache-writes session.region;
            // gating on region would silently skip hydration for returning
            // agent-mode users whose zone comes from storedUser, not an
            // explicit flag.
            if (session.credentials && session.selectedOrgId) {
              const { getStoredUser, getStoredToken } = await import(
                '../utils/ampli-settings.js'
              );
              const { fetchAmplitudeUser, extractAppId } = await import(
                '../lib/api.js'
              );
              const { resolveZone } = await import('../lib/zone-resolution.js');
              const { DEFAULT_AMPLITUDE_ZONE } = await import(
                '../lib/constants.js'
              );
              const storedUser = getStoredUser();
              const realUser =
                storedUser && storedUser.id !== 'pending' ? storedUser : null;
              // Fire-and-forget user refresh during CLI startup: session may
              // not yet have region set, so fall back to disk tiers.
              const zone = resolveZone(session, DEFAULT_AMPLITUDE_ZONE, {
                readDisk: true,
              });
              const storedToken = realUser
                ? getStoredToken(realUser.id, realUser.zone)
                : getStoredToken(undefined, zone);
              logToFile(
                `[bin] fire-and-forget: storedToken=${
                  storedToken ? 'found' : 'null'
                }`,
              );
              if (storedToken) {
                fetchAmplitudeUser(storedToken.idToken, zone)
                  .then((userInfo) => {
                    let changed = false;
                    if (userInfo.email && !session.userEmail) {
                      session.userEmail = userInfo.email;
                      changed = true;
                    }
                    if (userInfo.email) {
                      analytics.setDistinctId(userInfo.email);
                      analytics.identifyUser({
                        email: userInfo.email,
                        org_id: session.selectedOrgId ?? undefined,
                        org_name: session.selectedOrgName ?? undefined,
                        workspace_id: session.selectedWorkspaceId ?? undefined,
                        workspace_name:
                          session.selectedWorkspaceName ?? undefined,
                        app_id: session.selectedAppId,
                        env_name: session.selectedEnvName,
                        region: zone,
                        integration: session.integration,
                      });
                    }
                    if (session.selectedOrgId) {
                      // Fall back to the first org if the stored ID is stale
                      // (e.g. session checkpoint from a different account).
                      const org =
                        userInfo.orgs.find(
                          (o) => o.id === session.selectedOrgId,
                        ) ?? userInfo.orgs[0];
                      logToFile(
                        `[bin] fire-and-forget: orgs=${userInfo.orgs
                          .map((o) => o.id)
                          .join(',')}, looking for ${
                          session.selectedOrgId
                        }, using=${org?.id ?? 'none'}`,
                      );
                      if (org) {
                        session.selectedOrgName = org.name;
                        changed = true;
                        // Fall back to the first workspace if the stored ID is stale.
                        const ws = session.selectedWorkspaceId
                          ? org.workspaces.find(
                              (w) => w.id === session.selectedWorkspaceId,
                            ) ?? org.workspaces[0]
                          : org.workspaces[0];
                        if (ws) {
                          session.selectedWorkspaceName = ws.name;
                          // Extract the Amplitude app ID from the lowest-rank environment.
                          const appId = extractAppId(ws);
                          logToFile(
                            `[bin] app ID resolution: environments=${
                              ws.environments?.length ?? 'null'
                            }, appId=${appId}`,
                          );
                          if (appId) session.selectedAppId = appId;
                        } else {
                          logToFile(
                            `[bin] app ID resolution: no workspaces in org ${org.id}`,
                          );
                        }
                      }
                    }
                    if (changed && tui.store.session === session) {
                      tui.store.emitChange();
                    }
                  })
                  .catch((err: unknown) => {
                    logToFile(
                      `[bin] fire-and-forget fetchAmplitudeUser failed: ${
                        err instanceof Error ? err.message : String(err)
                      }`,
                    );
                  });
              }
            }
          }

          tui.store.session = session;

          // Load event plan from a previous run (if it exists) so the
          // Events tab is available immediately on returning runs.
          // Dynamic-import keeps the Claude Agent SDK out of bin.ts load.
          try {
            const fs = await import('fs');
            const { parseEventPlanContent } = await import(
              '../lib/agent-interface.js'
            );
            const evtPath = resolve(
              session.installDir,
              '.amplitude-events.json',
            );
            const events = parseEventPlanContent(
              fs.readFileSync(evtPath, 'utf-8'),
            );
            if (events && events.length > 0) {
              tui.store.setEventPlan(
                events.filter((e) => e.name.trim().length > 0),
              );
            }
          } catch {
            // No event plan file yet — that's fine
          }

          // Initialize Amplitude Experiment feature flags (non-blocking).
          const { initFeatureFlags } = await import('../lib/feature-flags.js');
          await initFeatureFlags().catch(() => {
            // Flag init failure is non-fatal — all flags default to off
          });

          // Apply SDK-level opt-out based on feature flags
          analytics.applyOptOut();

          const { FRAMEWORK_REGISTRY } = await import('../lib/registry.js');
          const { detectAllFrameworks } = await import('../run.js');
          const installDir = session.installDir ?? process.cwd();

          // Verbose startup diagnostics — always written to the log file;
          // visible in the RunScreen "Logs" tab.
          if (session.verbose || session.debug) {
            const { enableDebugLogs, logToFile } = await import(
              '../utils/debug.js'
            );
            enableDebugLogs();
            logToFile('[verbose] Amplitude Wizard starting');
            logToFile(`[verbose] node          : ${process.version}`);
            logToFile(`[verbose] process.cwd() : ${process.cwd()}`);
            logToFile(`[verbose] installDir    : ${installDir}`);
            logToFile(`[verbose] platform      : ${process.platform}`);
            logToFile(`[verbose] argv          : ${process.argv.join(' ')}`);
          }

          const { DETECTION_TIMEOUT_MS } = await import('../lib/constants.js');

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
                '../lib/ampli-config.js'
              );
              const { performAmplitudeAuth } = await import(
                '../utils/oauth.js'
              );
              const { fetchAmplitudeUser } = await import('../lib/api.js');
              const { DEFAULT_AMPLITUDE_ZONE } = await import(
                '../lib/constants.js'
              );
              const { storeToken } = await import('../utils/ampli-settings.js');

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
              const { resolveZone } = await import('../lib/zone-resolution.js');
              const zone = resolveZone(
                tui.store.session,
                DEFAULT_AMPLITUDE_ZONE,
                { readDisk: false },
              );

              // Try direct signup first when --signup + email + fullName are provided
              // and the feature flag is enabled. performSignupOrAuth returns null when
              // any of those gates are missing, or when the server returns a non-success
              // response — in which case we fall through to the existing OAuth flow
              // (TUI has a browser; this fallback is valid).
              //
              // On signup success, the wrapper already fetched the real user
              // profile (with provisioning retry) and persisted tokens to
              // ~/.ampli.json — so we carry its userInfo through and skip the
              // redundant fetch + storeToken below.
              let auth: Awaited<
                ReturnType<typeof performAmplitudeAuth>
              > | null = null;
              let signupUserInfo: Awaited<
                ReturnType<typeof fetchAmplitudeUser>
              > | null = null;
              // True iff direct signup produced fresh tokens in this run.
              // Used by the downstream fetchAmplitudeUser catch to
              // distinguish a provisioning-lag recovery (signup succeeded,
              // but user data not yet available) from the normal
              // expired-token case.
              let signupTokensObtained = false;
              const { trackSignupAttempt } = await import(
                '../utils/signup-or-auth.js'
              );
              const s = tui.store.session;
              if (s.signup && s.signupEmail && s.signupFullName) {
                const { performSignupOrAuth } = await import(
                  '../utils/signup-or-auth.js'
                );
                try {
                  const signupResult = await performSignupOrAuth({
                    email: s.signupEmail,
                    fullName: s.signupFullName,
                    zone,
                  });
                  if (signupResult !== null) {
                    auth = signupResult;
                    signupUserInfo = signupResult.userInfo;
                    signupTokensObtained = true;
                    getUI().log.info(
                      'Direct signup succeeded; using newly created account.',
                    );
                  }
                } catch (err) {
                  trackSignupAttempt({ status: 'wrapper_exception', zone });
                  getUI().log.warn(
                    `Direct signup errored: ${
                      err instanceof Error ? err.message : String(err)
                    }. Falling back to OAuth.`,
                  );
                  auth = null;
                }
              }

              if (auth === null) {
                auth = await performAmplitudeAuth({ zone, forceFresh });
              }

              // Update login URL (clears the "copy this URL" hint)
              tui.store.setLoginUrl(null);

              // Zone was already selected by the user before OAuth started.
              const cloudRegion = zone;

              let userInfo;
              if (signupUserInfo) {
                // Wrapper already fetched userInfo and stored tokens — no
                // redundant network call, no browser fallback needed.
                userInfo = signupUserInfo;
              } else {
                try {
                  userInfo = await fetchAmplitudeUser(
                    auth.idToken,
                    cloudRegion,
                  );
                } catch {
                  if (signupTokensObtained) {
                    // Signup succeeded moments ago so the tokens can't be
                    // expired — the fetch failure is almost certainly
                    // backend provisioning lag for a brand-new account.
                    // Surface the transition so the user isn't confused
                    // when a browser opens after "signup succeeded", and
                    // emit telemetry so we can measure how often the rare
                    // edge case actually hits production.
                    getUI().log.info(
                      'Account created, but user data is still being provisioned. ' +
                        'Opening browser to complete sign-in…',
                    );
                    trackSignupAttempt({
                      status: 'browser_fallback_after_signup',
                      zone,
                    });
                  }
                  // Token may be expired — re-open the browser for a fresh login
                  tui.store.setLoginUrl(null);
                  auth = await performAmplitudeAuth({
                    zone,
                    forceFresh: true,
                  });
                  userInfo = await fetchAmplitudeUser(
                    auth.idToken,
                    cloudRegion,
                  );
                }
                // Persist to ~/.ampli.json (signup path already did this)
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
              }

              // Populate user email for /whoami display
              session.userEmail = userInfo.email;
              analytics.setDistinctId(userInfo.email);
              analytics.identifyUser({ email: userInfo.email });

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
                getUI().log.error(
                  `OAuth setup error: ${
                    err instanceof Error ? err.message : String(err)
                  }`,
                );
              }
            }
          })();

          // ── Framework detection ────────────────────────────────
          // Runs concurrently with auth while AuthScreen shows.
          // Each detector has its own per-framework timeout internally,
          // so no outer timeout is needed.
          const detectionTask = (async () => {
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

            // Feature discovery — same helper that CI/agent uses, so the
            // package and integration lists never drift between modes.
            const { discoverFeatures } = await import(
              '../lib/feature-discovery.js'
            );
            const runDiscovery = () => {
              for (const f of discoverFeatures({
                installDir,
                integration: tui.store.session.integration,
              })) {
                tui.store.addDiscoveredFeature(f);
              }
            };
            runDiscovery();

            // Re-run when integration changes (handles manual selection
            // after auto-detection fails). Track last-seen to avoid the
            // package.json scan firing on every store emit.
            let lastIntegration = tui.store.session.integration;
            tui.store.subscribe(() => {
              const integration = tui.store.session.integration;
              if (integration === lastIntegration) return;
              lastIntegration = integration;
              runDiscovery();
            });

            // Signal detection is done — IntroScreen shows picker or results
            tui.store.setDetectionComplete();
          })();

          // Gate runWizard on the user reaching RunScreen — at that point
          // auth, data check, and any setup questions are all complete.
          const { Screen } = await import('../ui/tui/router.js');
          tui.store.onEnterScreen(Screen.Run, () => tui.store.completeSetup());

          // Session checkpointing — save at key transitions so crash
          // recovery can skip already-completed steps.
          const { saveCheckpoint, clearCheckpoint } = await import(
            '../lib/session-checkpoint.js'
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

          // (The SIGINT handler is now installed earlier, right after
          // startTUI(), to close a race window where early Ctrl+C would
          // bypass the handler and terminate immediately.)

          // Wait for auth and framework detection to finish concurrently.
          await Promise.all([authTask, detectionTask]);

          if (session.verbose || session.debug) {
            const { logToFile } = await import('../utils/debug.js');
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
            '../lib/detect-amplitude.js'
          );
          const localDetection = detectAmplitudeInProject(installDir);

          if (localDetection.confidence !== 'none') {
            const { logToFile: log } = await import('../utils/debug.js');
            log(
              `[bin] Amplitude already detected (${
                localDetection.reason ?? 'unknown'
              }) — prompting on MCP screen (continue vs run wizard)`,
            );
            const { RunPhase, OutroKind } = await import(
              '../lib/wizard-session.js'
            );
            tui.store.setAmplitudePreDetected();
            tui.store.setRunPhase(RunPhase.Completed);
            const runWizardAnyway = await tui.store.waitForPreDetectedChoice();
            if (runWizardAnyway) {
              log('[bin] user chose to run setup wizard despite pre-detection');
              tui.store.resetForAgentAfterPreDetected();
              await lazyRunWizard(
                options as Parameters<typeof lazyRunWizard>[0],
                tui.store.session,
                () => tui.store.session.additionalFeatureQueue,
                {
                  onFeatureStart: (f) => tui.store.setCurrentFeature(f),
                  onFeatureComplete: (f) => tui.store.markFeatureComplete(f),
                },
              );
            } else {
              tui.store.setOutroData({ kind: OutroKind.Success });
            }
          } else {
            await lazyRunWizard(
              options as Parameters<typeof lazyRunWizard>[0],
              tui.store.session,
              () => tui.store.session.additionalFeatureQueue,
              {
                onFeatureStart: (f) => tui.store.setCurrentFeature(f),
                onFeatureComplete: (f) => tui.store.markFeatureComplete(f),
              },
            );
          }

          // Keep the outro screen visible — let process.exit() handle cleanup
        } catch (err) {
          // TUI unavailable (e.g., in test environment) — continue with default UI.
          // Use console.error directly: startTUI() calls setUI(inkUI) before
          // render(), so if render() throws, getUI() returns an InkUI whose
          // renderer never started — messages would vanish into the store.
          if (process.env.DEBUG || process.env.AMPLITUDE_WIZARD_DEBUG) {
            console.error(
              `TUI init failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
          await lazyRunWizard(options as Parameters<typeof lazyRunWizard>[0]);
        }
      })();
    }
  },
};
