import type { CommandModule } from 'yargs';
import { resolve } from 'path';
import {
  getUI,
  setUI,
  LoggingUI,
  analytics,
  lazyRunWizard,
  buildSessionFromOptions,
  resolveNonInteractiveCredentials,
  runDirectSignupIfRequested,
  gateCiSignupAcceptToS,
  gateAgentSignupArguments,
} from './helpers';
import { WIZARD_VERSION } from './context';
import { isNonInteractiveEnvironment } from '../utils/environment';
import { ExitCode } from '../lib/exit-codes';
import {
  loadOrchestratorContext,
  resolveOrchestratorContextPath,
} from '../utils/orchestrator-context';
import type { WizardSession } from '../lib/wizard-session';

/**
 * Load `--context-file` (or `AMPLITUDE_WIZARD_CONTEXT`) and stamp the
 * resulting string onto `session.orchestratorContext`. Centralized here
 * so all four mode branches (agent / CI / classic / TUI) share one
 * read+validate path and emit one consistent error envelope.
 *
 * On failure: emits a structured NDJSON event in agent mode, plain
 * stderr in every other mode, then exits with INVALID_ARGS so the
 * orchestrator can distinguish "your config was bad" from "the wizard
 * crashed mid-run". Returns void so callers can `return` immediately.
 */
function applyOrchestratorContext(
  session: WizardSession,
  options: Record<string, unknown>,
  emitJson: boolean,
): void {
  const path = resolveOrchestratorContextPath(
    options['context-file'] as string | undefined,
  );
  if (!path) return;

  const result = loadOrchestratorContext(path, session.installDir);
  if (!result.ok) {
    if (emitJson) {
      process.stdout.write(
        JSON.stringify({
          v: 1,
          '@timestamp': new Date().toISOString(),
          type: 'error',
          message: result.message,
          data: {
            event: 'context_file_failed',
            reason: result.reason,
            sourcePath: result.sourcePath,
          },
        }) + '\n',
      );
    } else {
      process.stderr.write(
        `[wizard] --context-file: ${result.message} (${result.sourcePath})\n`,
      );
    }
    process.exit(ExitCode.INVALID_ARGS);
  }

  session.orchestratorContext = result.content;
}

/**
 * If `--resume` was passed, look up the per-project checkpoint and
 * restore its fields onto the session BEFORE credentials are
 * resolved. Silently no-ops when no fresh checkpoint exists so
 * orchestrators can pass `--resume` unconditionally on every retry
 * without branching on disk state. Used by the agent / CI mode
 * branches; TUI mode has its own restore path inside the auth task.
 *
 * Telemetry: `loadCheckpoint` emits `progress: checkpoint_loaded` on
 * success — no extra plumbing needed here.
 */
async function maybeResumeFromCheckpoint(
  session: WizardSession,
  options: Record<string, unknown>,
): Promise<void> {
  if (!options.resume) return;
  const { loadCheckpoint } = await import('../lib/session-checkpoint.js');
  const restored = await loadCheckpoint(session.installDir);
  if (!restored) return;
  Object.assign(session, restored);
  // Treat resume as an explicit user action — the intro / region pick
  // screens shouldn't replay just because the checkpoint had stale
  // intro state. (TUI mode handles this with its own
  // `_restoredFromCheckpoint` flag; for headless mode the equivalent
  // is "we skipped past the screens, don't second-guess.")
  session.introConcluded = true;
}

export const defaultCommand: CommandModule = {
  command: ['$0'],
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
      // `--mode` is intentionally hidden. See `docs/internal/agent-mode-flag.md`
      // for the full rationale and the model mapping. Briefly: this is an
      // internal performance / capability knob — not advertised in --help,
      // README, CLAUDE.md, or any agent-facing skill, and not for casual
      // recommendation. The default ('standard') is the only tier most
      // users should ever see.
      mode: {
        default: 'standard',
        choices: ['fast', 'standard', 'thorough'] as const,
        describe: 'internal — see docs/internal/agent-mode-flag.md',
        type: 'string',
        hidden: true,
      },
      agent: {
        default: false,
        describe: 'emit structured NDJSON output for automation',
        type: 'boolean',
      },
      classic: {
        default: false,
        describe: 'use the classic prompt-based UI',
        type: 'boolean',
      },
      'context-file': {
        // Lets an outer agent / CI pipeline inject team conventions
        // ("we use snake_case for events", existing taxonomy snippets,
        // project-specific guidance) WITHOUT modifying any skill content.
        // The file is read once at startup and prepended to every agent
        // turn's system prompt. 64 KB cap; UTF-8; falls back to
        // AMPLITUDE_WIZARD_CONTEXT env var when the flag is omitted.
        describe:
          'path to a file whose contents are injected into the inner-agent system prompt',
        type: 'string',
      },
      resume: {
        // In agent / CI mode: load the per-project crash-recovery
        // checkpoint at startup so a rerun skips already-completed
        // setup steps (region pick, framework detection, org/project
        // selection). TUI mode auto-restores; this flag is the
        // headless equivalent. Silently no-ops when no checkpoint
        // exists so orchestrators can pass `--resume` unconditionally
        // without branching on disk state.
        default: false,
        describe:
          'load the saved checkpoint and skip already-completed setup steps',
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
        !options.force &&
        // --auto-approve grants ONLY auto-approve, not writes — so a
        // user who passes only --auto-approve in a non-TTY env should
        // NOT be auto-promoted to agent mode (which would otherwise
        // route through resolveMode's --agent back-compat path).
        !options['auto-approve'] &&
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
        applyOrchestratorContext(session, options, true);
        await maybeResumeFromCheckpoint(session, options);

        if (!gateAgentSignupArguments(session, agentUI)) {
          return;
        }

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
    } else if (options.ci || options.yes || options.force) {
      // CI mode: no prompts, auto-select first environment
      setUI(new LoggingUI());
      if (!options.installDir) options.installDir = process.cwd();

      void (async () => {
        const session = await buildSessionFromOptions(options, { ci: true });
        applyOrchestratorContext(session, options, false);
        await maybeResumeFromCheckpoint(session, options);

        if (!gateCiSignupAcceptToS(session)) {
          return;
        }

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
        applyOrchestratorContext(session, options, false);

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

          // Build the session from CLI args BEFORE starting the TUI so the
          // initial render reflects --install-dir (and any other flag-driven
          // session fields) instead of the WizardStore's default
          // `buildSession({})` which falls back to process.cwd(). Without
          // this, a user who runs `pnpm try --install-dir=/some/app` sees
          // the wizard's own cwd in the IntroScreen Target line for the
          // ~seconds it takes to resolve OAuth credentials, until the
          // `tui.store.session = session` swap below runs.
          const session = await buildSessionFromOptions(options);
          // Loading the orchestrator context BEFORE startTUI so a bad
          // path fails fast on stderr (no half-rendered TUI to tear
          // down). The TUI branch keeps NDJSON off — interactive users
          // get a plain error message they can read.
          applyOrchestratorContext(session, options, false);
          const tui = startTUI(WIZARD_VERSION, undefined, session);

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

          // Session is already built above (and attached to the store via
          // startTUI's initialSession arg). Continue mutating it for
          // checkpoint restoration / credential resolution; the final
          // `tui.store.session = session` below re-emits the change.

          // If --api-key was provided, skip the OAuth/TUI auth flow entirely.
          if (session.apiKey) {
            const { DEFAULT_HOST_URL } = await import('../lib/constants.js');
            // See AMPLITUDE_WIZARD_PROXY_BEARER comment in the agent/ci
            // branch above — same separation applies here.
            const proxyBearer =
              process.env.AMPLITUDE_WIZARD_PROXY_BEARER?.trim() ||
              session.apiKey;
            session.credentials = {
              accessToken: proxyBearer,
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

            // If resolveCredentials silently picked an org/project from
            // disk (returning-user path), require an explicit confirmation
            // before routing the run against it. The Auth flow gate reads
            // this flag — without it we could silently target a project
            // the user didn't intend (especially after upgrading from an
            // old wizard version where project IDs may have rolled over).
            // Skipped in --ci / --agent mode where there is no interactive
            // confirm step and the user has already opted into automation.
            if (
              session.credentials !== null &&
              !session.ci &&
              !session.agent &&
              (session.selectedOrgId || session.selectedProjectId)
            ) {
              session.requiresAccountConfirmation = true;
            }

            // Resolve org/project display names so /whoami shows them.
            // Also extracts the numeric analytics project ID for MCP event detection.
            // Fire-and-forget so it doesn't block startup.
            // Hydrate org/project display names after credential
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
                        project_id: session.selectedProjectId ?? undefined,
                        project_name: session.selectedProjectName ?? undefined,
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
                        // Fall back to the first project if the stored ID is stale.
                        const project = session.selectedProjectId
                          ? org.projects.find(
                              (p) => p.id === session.selectedProjectId,
                            ) ?? org.projects[0]
                          : org.projects[0];
                        if (project) {
                          session.selectedProjectName = project.name;
                          // Extract the Amplitude app ID from the lowest-rank environment.
                          const appId = extractAppId(project);
                          logToFile(
                            `[bin] app ID resolution: environments=${
                              project.environments?.length ?? 'null'
                            }, appId=${appId}`,
                          );
                          if (appId) session.selectedAppId = appId;
                        } else {
                          logToFile(
                            `[bin] app ID resolution: no projects in org ${org.id}`,
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
          // Import from the lightweight parser module (not agent-interface)
          // so we don't pull in the Claude Agent SDK / UI singleton here.
          try {
            const fs = await import('fs');
            const { parseEventPlanContent } = await import(
              '../lib/event-plan-parser.js'
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

          // ── OAuth + account setup ──────────────────────────────
          // Runs concurrently with framework detection while AuthScreen shows.
          // When OAuth completes, store.setOAuthComplete() triggers the
          // AuthScreen SUSI pickers (org → workspace → API key).
          // AuthScreen calls store.setCredentials() when done, advancing the
          // router past Auth → RegionSelect → DataSetup → to IntroScreen.
          const authTask = (async () => {
            // If we silently resolved credentials from disk on a returning
            // run, the user is currently looking at the account-confirm
            // step inside AuthScreen. Wait for them to either accept (the
            // task can short-circuit and exit) or reject (credentials get
            // cleared so we proceed into the OAuth pipeline below). Without
            // this wait the task would early-return and leave the user
            // stranded if they pressed [C] to change project.
            if (tui.store.session.requiresAccountConfirmation) {
              await new Promise<void>((resolve) => {
                if (!tui.store.session.requiresAccountConfirmation) {
                  resolve();
                  return;
                }
                const unsub = tui.store.subscribe(() => {
                  if (!tui.store.session.requiresAccountConfirmation) {
                    unsub();
                    resolve();
                  }
                });
              });
            }
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
                // Probe the cached token with a bounded timeout. On a
                // returning user from an older wizard version,
                // performAmplitudeAuth can silently reuse a stored token
                // whose idToken is rejected by the API (or whose call
                // hangs). Without this bound the user sits on AuthScreen
                // Step 1 with no URL until the network stack gives up —
                // that's the "blank auth screen" symptom. Treat a timeout
                // as a fetch failure and force a fresh OAuth so the
                // browser opens and setLoginUrl fires immediately.
                const STALE_TOKEN_PROBE_MS = 8_000;
                // Capture the current (non-null) auth reference for the
                // closure — the outer `auth` is typed `T | null` and the
                // narrowing from the `if (auth === null)` branch above
                // doesn't propagate into the inner async function. The
                // catch block below may reassign auth on probe failure.
                const probeAuth = auth;
                const probeFetchUser = async () => {
                  let timer: ReturnType<typeof setTimeout> | undefined;
                  try {
                    return await Promise.race([
                      fetchAmplitudeUser(probeAuth.idToken, cloudRegion),
                      new Promise<never>((_, reject) => {
                        timer = setTimeout(() => {
                          const err = new Error(
                            `cached-token probe timed out after ${STALE_TOKEN_PROBE_MS}ms`,
                          );
                          err.name = 'TimeoutError';
                          reject(err);
                        }, STALE_TOKEN_PROBE_MS);
                      }),
                    ]);
                  } finally {
                    if (timer !== undefined) clearTimeout(timer);
                  }
                };
                try {
                  userInfo = await probeFetchUser();
                } catch (probeErr) {
                  const { logToFile: log } = await import('../utils/debug.js');
                  log(
                    '[bin] cached-token probe failed; forcing fresh OAuth',
                    probeErr instanceof Error
                      ? probeErr.message
                      : String(probeErr),
                  );
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

              // Signal AuthScreen — triggers org/project/API key pickers
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

          // ── Mid-session re-auth watcher (handles /region) ──────────
          // setRegionForced() clears credentials and pendingOrgs so the
          // RegionSelect screen re-appears. Once the user picks a new
          // region, the Auth flow gate would otherwise sit on a blank
          // AuthScreen because `authTask` is single-shot — it's already
          // resolved against the OLD region. This watcher re-fires the
          // OAuth pipeline against the new region so AuthScreen actually
          // makes progress.
          //
          // PR #296 (the bin.ts split) silently dropped this watcher —
          // /region mid-session has been broken on main since that
          // refactor. Restoring it here. The probe + bounded fetchUser
          // (same as authTask) catches stale tokens that would otherwise
          // leave the new-region AuthScreen blank after a region switch.
          //
          // Deferred until authTask resolves so the watcher doesn't add
          // a second subscribe during the initial-auth window.
          void (async () => {
            await authTask;
            const { Overlay } = await import('../ui/tui/router.js');
            const { performAmplitudeAuth } = await import('../utils/oauth.js');
            const { fetchAmplitudeUser } = await import('../lib/api.js');
            const { storeToken } = await import('../utils/ampli-settings.js');
            const { resolveZone } = await import('../lib/zone-resolution.js');
            const { DEFAULT_AMPLITUDE_ZONE } = await import(
              '../lib/constants.js'
            );

            const waitForSessionState = (
              predicate: () => boolean,
            ): Promise<void> =>
              new Promise<void>((resolve) => {
                if (predicate()) {
                  resolve();
                  return;
                }
                const unsub = tui.store.subscribe(() => {
                  if (predicate()) {
                    unsub();
                    resolve();
                  }
                });
              });

            // Single OAuth + fetchUser + setOAuthComplete cycle against
            // the currently-selected region. Includes the same
            // stale-token probe as authTask so a returning user who
            // switches regions doesn't get stuck on a blank AuthScreen
            // when their old per-zone token in ~/.ampli.json works for
            // performAmplitudeAuth's cache check but fails the
            // fetchAmplitudeUser call against the new zone.
            const runReauthCycle = async (): Promise<void> => {
              const zone = resolveZone(
                tui.store.session,
                DEFAULT_AMPLITUDE_ZONE,
                { readDisk: false },
              );

              let auth = await performAmplitudeAuth({
                zone,
                forceFresh: false,
              });
              tui.store.setLoginUrl(null);

              const STALE_TOKEN_PROBE_MS = 8_000;
              const probeAuth = auth;
              const probeFetchUser = async () => {
                let timer: ReturnType<typeof setTimeout> | undefined;
                try {
                  return await Promise.race([
                    fetchAmplitudeUser(probeAuth.idToken, zone),
                    new Promise<never>((_, reject) => {
                      timer = setTimeout(() => {
                        const err = new Error(
                          `cached-token probe timed out after ${STALE_TOKEN_PROBE_MS}ms`,
                        );
                        err.name = 'TimeoutError';
                        reject(err);
                      }, STALE_TOKEN_PROBE_MS);
                    }),
                  ]);
                } finally {
                  if (timer !== undefined) clearTimeout(timer);
                }
              };

              let userInfo;
              try {
                userInfo = await probeFetchUser();
              } catch (probeErr) {
                const { logToFile } = await import('../utils/debug.js');
                logToFile(
                  '[reauth] cached-token probe failed; forcing fresh OAuth',
                  probeErr instanceof Error
                    ? probeErr.message
                    : String(probeErr),
                );
                tui.store.setLoginUrl(null);
                auth = await performAmplitudeAuth({ zone, forceFresh: true });
                userInfo = await fetchAmplitudeUser(auth.idToken, zone);
              }

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

              tui.store.setUserEmail(userInfo.email);
              analytics.setDistinctId(userInfo.email);
              analytics.identifyUser({ email: userInfo.email });

              tui.store.setOAuthComplete({
                accessToken: auth.accessToken,
                idToken: auth.idToken,
                cloudRegion: zone,
                orgs: userInfo.orgs,
              });
            };

            // Bounded retry loop. Three consecutive failures and we
            // back off until the user takes manual action (/login or
            // /region) — prevents hot-spinning OAuth attempts when the
            // new zone keeps rejecting.
            let consecutiveFailures = 0;
            while (true) {
              // Wait for credentials to populate (via initial authTask
              // or a previous SUSI completion).
              await waitForSessionState(
                () => tui.store.session.credentials !== null,
              );

              // Then wait for them to be cleared AND the user to have
              // picked a new region. setRegionForced clears credentials;
              // the subsequent setRegion clears regionForced.
              //
              // Skip when /logout is active (loggingOut flag) or an
              // outro is queued — /logout clears credentials and exits
              // 1.5s later; without this guard the watcher would race
              // the exit and pop a browser during "Logged out".
              await waitForSessionState(
                () =>
                  !tui.store.session.loggingOut &&
                  tui.store.session.credentials === null &&
                  tui.store.session.region !== null &&
                  !tui.store.session.regionForced &&
                  tui.store.session.introConcluded &&
                  tui.store.currentScreen !== Overlay.Logout &&
                  tui.store.session.outroData === null,
              );

              try {
                await runReauthCycle();
                consecutiveFailures = 0;
              } catch (err) {
                consecutiveFailures += 1;
                if (process.env.DEBUG || process.env.AMPLITUDE_WIZARD_DEBUG) {
                  console.error('Re-auth error:', err);
                }
                tui.store.setCommandFeedback(
                  consecutiveFailures === 1
                    ? "Authentication didn't complete. Retrying — use /login to retry manually."
                    : `Authentication failed (attempt ${consecutiveFailures}). Use /login to retry manually.`,
                  consecutiveFailures >= 3 ? 8000 : 4000,
                );
                if (consecutiveFailures >= 3) {
                  // After 3 strikes, stop auto-retrying. The user can
                  // resume via /login or /region; both clear credentials
                  // and unblock the watcher.
                  await waitForSessionState(
                    () =>
                      tui.store.currentScreen === Overlay.Login ||
                      tui.store.session.regionForced,
                  );
                  consecutiveFailures = 0;
                  continue;
                }
                // Linear backoff before next attempt.
                await new Promise<void>((r) =>
                  setTimeout(r, 1500 * consecutiveFailures),
                );
              }
            }
          })();

          // ── Framework detection ────────────────────────────────
          // Runs concurrently with auth while AuthScreen shows. Each
          // detector has its own per-framework timeout internally, so
          // no outer timeout is needed. The shared `runFrameworkDetection`
          // helper handles detect → gatherContext → setFrameworkConfig →
          // discoverFeatures → autoEnableInlineAddons → setDetectionComplete
          // in the right order, including the abort-aware short-circuits
          // that let a directory change mid-detection cancel the
          // in-flight run cleanly.
          const { runFrameworkDetection } = await import(
            '../lib/framework-detection.js'
          );

          // 1) Wire the redetector so the IntroScreen's "Change directory"
          //    flow can re-run detection against a new tree. Without
          //    this, `store.changeInstallDir(newDir)` resets
          //    `detectionComplete=false` but the spinner never advances —
          //    it sat there forever before this hookup.
          tui.store.setFrameworkRedetector((newDir, signal) =>
            runFrameworkDetection(tui.store, newDir, { signal }),
          );

          // 2) Run the INITIAL detection with an abort controller the
          //    store can reach. If the user picks "Change directory"
          //    while this first run is still scanning, the store cancels
          //    it through this controller so a stale
          //    `setDetectionComplete()` can't fire after the directory
          //    swap.
          const detectionController = new AbortController();
          tui.store.registerActiveDetection(detectionController);
          const detectionTask = runFrameworkDetection(tui.store, installDir, {
            signal: detectionController.signal,
          });

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
            saveCheckpoint(tui.store.session, 'screen_data_setup');
          });
          // Before agent starts (captures all setup state)
          tui.store.onEnterScreen(Screen.Run, () => {
            saveCheckpoint(tui.store.session, 'screen_run');
          });
          // Clear checkpoint only on successful completion — error/cancel
          // should preserve the checkpoint so users can resume next run.
          tui.store.onEnterScreen(Screen.Outro, () => {
            if (tui.store.session.outroData?.kind === 'success') {
              clearCheckpoint(tui.store.session.installDir, 'success');
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
