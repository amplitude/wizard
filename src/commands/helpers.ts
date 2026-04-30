// Shared helpers used by multiple command modules. Extracted from the
// monolithic bin.ts so each per-command file can stay focused on its
// own builder/handler.

import { getUI, setUI } from '../ui';
import type { AgentUI } from '../ui/agent-ui';
import { LoggingUI } from '../ui/logging-ui';
import { ExitCode } from '../lib/exit-codes';
import { analytics } from '../utils/analytics';
import type { AmplitudeZone } from '../lib/constants';
import { TERMS_OF_SERVICE_URL } from '../lib/constants.js';
import { setProjectLogFile } from '../lib/observability';
import { runMigrationShim } from '../utils/storage-migration';
import { CLI_INVOCATION } from './context';

// Dynamic import to avoid preloading wizard-session.ts as CJS, which
// prevents the TUI's ESM dynamic imports from resolving named exports.
export const lazyRunWizard = async (
  ...args: Parameters<typeof import('../run')['runWizard']>
) => {
  const { runWizard } = await import('../run.js');
  return runWizard(...args);
};

/**
 * Bootstrap per-project storage state once `installDir` is known. Idempotent:
 *
 *   1. Runs the one-shot migration shim FIRST — moves any pre-refactor paths
 *      (e.g. `/tmp/amplitude-wizard.log`, `<installDir>/.amplitude-events.json`)
 *      into the new layout. Drop after one release.
 *   2. THEN switches the logger from `<cacheRoot>/bootstrap.log` to the
 *      per-project file under `<cacheRoot>/runs/<hash>/log.txt`. Two
 *      parallel wizard runs in different directories no longer share a log.
 *
 * Order matters: migration runs before the logger switches because
 * `setProjectLogFile` writes a "continuing in <target>" marker to the
 * bootstrap log. If that marker created `<cacheRoot>/bootstrap.log` first,
 * the migration's "skip when destination exists" branch would discard the
 * legacy `/tmp/amplitude-wizard.log` content instead of moving it across.
 *
 * Called from `buildSessionFromOptions` so every entry path picks it up
 * automatically (TUI, agent, CI, sub-commands). Skipped when
 * `AMPLITUDE_WIZARD_SKIP_BOOTSTRAP=1` (wizard-internal opt-out) because
 * vitest module mocks don't always intercept the dynamic-import chain
 * bin.ts uses, and CLI tests aren't exercising the storage migration
 * anyway — there's a dedicated test suite for that. We deliberately do
 * NOT gate on `NODE_ENV=test`: real users sometimes run the wizard
 * inside a test harness (e.g. their app's CI), and they should still
 * get migration + per-project log routing.
 */
function bootstrapInstallDir(installDir: string): void {
  if (process.env.AMPLITUDE_WIZARD_SKIP_BOOTSTRAP === '1') return;
  runMigrationShim(installDir);
  setProjectLogFile(installDir);
}

/**
 * Build a WizardSession from CLI argv, avoiding the repeated 12-field literal.
 * Also runs `bootstrapInstallDir` so every command path migrates legacy
 * storage and switches the logger to the per-project location once
 * `installDir` is known.
 */
export const buildSessionFromOptions = async (
  options: Record<string, unknown>,
  overrides?: { ci?: boolean },
) => {
  const { buildSession } = await import('../lib/wizard-session.js');
  const session = buildSession({
    debug: options.debug as boolean | undefined,
    verbose: options.verbose as boolean | undefined,
    forceInstall: options.forceInstall as boolean | undefined,
    installDir: options.installDir as string | undefined,
    ci: overrides?.ci ?? false,
    signup: options.signup as boolean | undefined,
    localMcp: options.localMcp as boolean | undefined,
    apiKey: options.apiKey as string | undefined,
    menu: options.menu as boolean | undefined,
    signupEmail: options.email as string | undefined,
    signupFullName: options['full-name'] as string | undefined,
    acceptTos:
      options.acceptTos === true ||
      (options['accept-tos'] as boolean | undefined) === true,
    // --region is canonical; --zone is a yargs alias, so `options.region`
    // is populated by either flag.
    region: options.region as AmplitudeZone | undefined,
    integration: options.integration as Parameters<
      typeof buildSession
    >[0]['integration'],
    benchmark: options.benchmark as boolean | undefined,
    mode: options.mode as 'fast' | 'standard' | 'thorough' | undefined,
    // --app-id is the canonical flag; --project-id is now a separate flag that
    // refers to the Amplitude project (formerly workspace), not the app.
    appId: options.appId as string | undefined,
    appName: options.appName as string | undefined,
  });
  bootstrapInstallDir(session.installDir);
  return session;
};

/**
 * Shared credential resolution for non-interactive modes (agent + CI).
 * Handles --api-key shortcut, OAuth token refresh, and pendingOrgs.
 *
 * @param mode - 'agent' prompts via AgentUI, 'ci' auto-selects first env
 */
export const resolveNonInteractiveCredentials = async (
  session: import('../lib/wizard-session').WizardSession,
  options: Record<string, unknown>,
  mode: 'agent' | 'ci',
  agentUI?: import('../ui/agent-ui').AgentUI,
) => {
  // Fast path: --api-key / AMPLITUDE_WIZARD_API_KEY provided. This is a real
  // project API key, safe to embed into generated client-side code (it ends
  // up in amplitude.init('${projectApiKey}') calls).
  //
  // AMPLITUDE_TOKEN / AMPLITUDE_WIZARD_TOKEN is an OAuth *access token*, NOT a
  // project API key. It must never be used as projectApiKey — doing so would
  // (a) leak an OAuth secret into client bundles and (b) break SDK init since
  // it isn't a valid ingestion key. OAuth tokens fall through to
  // resolveCredentials below, which reads the full stored session from
  // ~/.ampli.json (idToken, refreshToken) and fetches the real project API
  // key from the Amplitude API.
  if (session.apiKey) {
    const { DEFAULT_HOST_URL } = await import('../lib/constants.js');
    // Normally `accessToken` and `projectApiKey` are the same value (the
    // project API key — embeddable in client bundles, also accepted by
    // the Amplitude wizard-proxy). For CI / smoke-test scenarios that
    // need to authenticate against the wizard-proxy with a real OAuth
    // bearer (e.g. a Hydra service-account token) while still embedding
    // the project API key into generated SDK init code, set
    // `AMPLITUDE_WIZARD_PROXY_BEARER` to the OAuth bearer. The bearer is
    // used only for outbound auth headers; `session.apiKey` continues to
    // flow into generated `amplitude.init('<projectApiKey>')` calls.
    const proxyBearer =
      process.env.AMPLITUDE_WIZARD_PROXY_BEARER?.trim() || session.apiKey;
    session.credentials = {
      accessToken: proxyBearer,
      projectApiKey: session.apiKey,
      host: DEFAULT_HOST_URL,
      appId: session.appId ?? 0,
    };
    session.projectHasData = false;
    return;
  }

  // Resolve credentials from stored OAuth tokens. AMPLITUDE_TOKEN /
  // AMPLITUDE_WIZARD_TOKEN (if set) overrides the stored access token so
  // an automation can inject a fresh one — but a prior `amplitude-wizard
  // login` is still required because we need the stored idToken to fetch
  // the project API key.
  const envAccessToken =
    process.env.AMPLITUDE_TOKEN ?? process.env.AMPLITUDE_WIZARD_TOKEN;
  const { resolveCredentials, resolveEnvironmentSelection } = await import(
    '../lib/credential-resolution.js'
  );
  // Prefer --project-id (canonical); fall back to --workspace-id (hidden legacy alias).
  const projectIdFlag =
    (options.projectId as string | undefined) ??
    (options.workspaceId as string | undefined);
  await resolveCredentials(session, {
    requireOrgId: false,
    org: options.org as string | undefined,
    env: options.env as string | undefined,
    projectId: projectIdFlag,
    appId: options.appId as string | undefined,
    accessTokenOverride: envAccessToken,
  });

  // ── Non-interactive create-project ────────────────────────────────
  // `--project-name <name>` triggers an inline project creation when the
  // authenticated user has an org but no projects to choose from (or when
  // the orchestrator explicitly asks for a fresh project). Must not prompt.
  const projectName = (options.appName as string | undefined)?.trim();
  if (
    projectName &&
    session.pendingOrgs &&
    !session.credentials &&
    session.pendingAuthIdToken &&
    session.pendingAuthAccessToken
  ) {
    const { createAmplitudeApp, ApiError } = await import('../lib/api.js');
    const { getHostFromRegion } = await import('../utils/urls.js');
    const { persistApiKey } = await import('../utils/api-key-store.js');

    // Pick an org: --org flag if provided, else the first org with access.
    const orgFlag = (options.org as string | undefined)?.toLowerCase();
    const org =
      (orgFlag &&
        session.pendingOrgs.find(
          (o) =>
            o.name.toLowerCase() === orgFlag || o.id.toLowerCase() === orgFlag,
        )) ||
      session.pendingOrgs[0];

    if (!org) {
      if (mode === 'agent' && agentUI) {
        agentUI.emitProjectCreateError({
          code: 'MISSING_ORG',
          message:
            'No Amplitude organization available to create a project in.',
          name: projectName,
        });
      } else {
        getUI().log.error(
          'No Amplitude organization available to create a project in.',
        );
      }
      process.exit(ExitCode.AUTH_REQUIRED);
    }

    const { resolveZone } = await import('../lib/zone-resolution.js');
    const { DEFAULT_AMPLITUDE_ZONE } = await import('../lib/constants.js');
    const { toCredentialAppId } = await import('../lib/wizard-session.js');
    // Pre-OAuth CLI path: session.region may be unset, fall back to disk tiers.
    const zone = resolveZone(session, DEFAULT_AMPLITUDE_ZONE, {
      readDisk: true,
    });
    if (mode === 'agent' && agentUI) {
      agentUI.emitProjectCreateStart({ orgId: org.id, name: projectName });
    } else {
      getUI().log.info(
        `Creating Amplitude project "${projectName}" in ${org.name}…`,
      );
    }

    try {
      const created = await createAmplitudeApp(
        session.pendingAuthAccessToken,
        zone,
        { orgId: org.id, name: projectName },
      );

      // Persist outside the API's error path — the project exists on the
      // backend at this point. A local persist failure (FS permission, etc.)
      // must not be reported as a create-project error, because the
      // orchestrator retry would then hit NAME_TAKEN.
      try {
        persistApiKey(created.apiKey, session.installDir);
      } catch (persistErr) {
        const msg =
          persistErr instanceof Error ? persistErr.message : String(persistErr);
        getUI().log.warn(
          `Project created but failed to persist API key locally: ${msg}. ` +
            `Set AMPLITUDE_API_KEY=<key> manually or rerun once the issue is resolved.`,
        );
      }
      session.selectedOrgId = org.id;
      session.selectedOrgName = org.name;
      session.selectedEnvName = created.name;
      session.credentials = {
        accessToken: session.pendingAuthAccessToken ?? '',
        idToken: session.pendingAuthIdToken,
        projectApiKey: created.apiKey,
        host: getHostFromRegion(zone),
        appId: toCredentialAppId(created.appId),
      };
      session.projectHasData = false;

      if (mode === 'agent' && agentUI) {
        agentUI.emitProjectCreateSuccess({
          appId: created.appId,
          name: created.name,
          orgId: org.id,
        });
      } else {
        getUI().log.info(`Project created: ${created.name} (${created.appId})`);
      }
    } catch (err) {
      const isApi = err instanceof ApiError;
      const code = isApi && err.code ? err.code : 'INTERNAL';
      const message = err instanceof Error ? err.message : String(err);

      if (mode === 'agent' && agentUI) {
        agentUI.emitProjectCreateError({
          code: code as Parameters<
            typeof agentUI.emitProjectCreateError
          >[0]['code'],
          message,
          name: projectName,
        });
      } else {
        getUI().log.error(`Create project failed (${code}): ${message}`);
      }

      // NAME_TAKEN gets a dedicated exit code so orchestrators can
      // distinguish "pick a new name" from generic failures.
      if (code === 'NAME_TAKEN') process.exit(ExitCode.PROJECT_NAME_TAKEN);
      if (code === 'FORBIDDEN' || code === 'QUOTA_REACHED')
        process.exit(ExitCode.AUTH_REQUIRED);
      if (code === 'INVALID_REQUEST') process.exit(ExitCode.INVALID_ARGS);
      process.exit(ExitCode.AGENT_FAILED);
    }
  }

  // Handle multiple environments
  if (session.pendingOrgs && !session.credentials) {
    if (mode === 'ci') {
      // CI mode: auto-select first environment with an API key
      for (const org of session.pendingOrgs) {
        for (const project of org.projects) {
          const env = (project.environments ?? [])
            .filter((e) => e.app?.apiKey)
            .sort((a, b) => a.rank - b.rank)[0];
          if (env) {
            await resolveEnvironmentSelection(session, {
              orgId: org.id,
              projectId: project.id,
              env: env.name,
            });
            getUI().log.info(
              `Resolved Amplitude API key non-interactively (CI mode): ${org.name} / ${project.name} / ${env.name}`,
            );
            break;
          }
        }
        if (session.credentials) break;
      }
      if (!session.credentials) {
        if (projectName) {
          // --project-name was provided but the create-project block was
          // skipped (e.g. missing idToken). Surface a clear error instead
          // of silently continuing without credentials.
          process.stderr.write(
            'Error: could not create project — authentication token is missing or expired. ' +
              `Run \`${CLI_INVOCATION} login\` and re-run.\n`,
          );
          process.exit(ExitCode.AUTH_REQUIRED);
        } else {
          process.stderr.write(
            'Error: no Amplitude projects with API keys available. ' +
              'Pass `--project-name "<name>"` to create one, or create one ' +
              'in the Amplitude UI and re-run.\n',
          );
          process.exit(ExitCode.INVALID_ARGS);
        }
      }
    } else if (agentUI) {
      // Agent mode: emit a structured prompt event with the full
      // org/project/app/env hierarchy. The orchestrator can either
      // reply on stdin with { appId } or re-invoke with --app-id (globally
      // unique, identifies the env directly).
      //
      // If the orchestrator provides an unknown appId, promptEnvironmentSelection
      // THROWS rather than silently picking a random env — we route that to
      // env_selection_failed with the mismatch message in the instruction.
      let selection: Awaited<
        ReturnType<(typeof agentUI)['promptEnvironmentSelection']>
      >;
      try {
        selection = await agentUI.promptEnvironmentSelection(
          session.pendingOrgs,
        );
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        agentUI.emitAuthRequired({
          reason: 'env_selection_failed',
          instruction:
            `${detail} Re-run ${CLI_INVOCATION} with --app-id <id> set to ` +
            'a value from the choices array in the last prompt event.',
          loginCommand: [...CLI_INVOCATION.split(' '), 'login'],
        });
        process.exit(ExitCode.AUTH_REQUIRED);
      }
      const resolved = await resolveEnvironmentSelection(session, selection);
      if (!resolved) {
        agentUI.emitAuthRequired({
          reason: 'env_selection_failed',
          instruction:
            'Could not resolve an Amplitude environment with an API key. ' +
            `Pass --app-id <id> when re-running ${CLI_INVOCATION}.`,
          loginCommand: [...CLI_INVOCATION.split(' '), 'login'],
        });
        process.exit(ExitCode.AUTH_REQUIRED);
      }
    }
  }

  // If we still don't have credentials, auth is required. Distinguish
  // "you've never logged in" from "your stored login is broken" — both
  // conditions surface here, but only the first is solvable by a fresh
  // `wizard login`. If a stored token still exists at this point,
  // resolveCredentials decided not to use it (refresh failed, idToken
  // expired, fetchAmplitudeUser 401'd, etc.). Calling that
  // `no_stored_credentials` is wrong: orchestrators that key off the
  // reason will tell the user to run `wizard login` even though they
  // already have, and the underlying token issue won't be obvious.
  if (!session.credentials) {
    if (mode === 'agent' && agentUI) {
      const { getStoredToken } = await import('../utils/ampli-settings.js');
      const { resolveZone } = await import('../lib/zone-resolution.js');
      const { DEFAULT_AMPLITUDE_ZONE } = await import('../lib/constants.js');
      const zone = resolveZone(session, DEFAULT_AMPLITUDE_ZONE, {
        readDisk: true,
      });
      const stored = getStoredToken(undefined, zone);

      // Three-way reason classification, ordered most→least specific:
      //
      //   1. No stored token at all → user has never logged in.
      //      `no_stored_credentials` — orchestrators tell the user to run
      //      `wizard login`.
      //
      //   2. Stored token whose `expiresAt` is in the past → id_token
      //      legitimately expired. `token_expired` — same remediation
      //      (refresh via login), but the orchestrator now knows credentials
      //      *were* present and the failure is age-related, not setup-related.
      //
      //   3. Stored token whose `expiresAt` is still in the future → silent
      //      refresh failed for a non-token reason (network blip, server-
      //      side refresh_token revoke, transient 5xx, etc). `refresh_failed`
      //      — the user should retry rather than re-login. Telling them
      //      to run `wizard login` for a network blip is actively misleading.
      //
      // expiresAt is sourced from the id_token's `exp` claim post the
      // jwt-exp.ts cleanup, so this check accurately reflects id_token
      // freshness rather than whatever client-side stamp was guessed at
      // login time.
      let reason: 'no_stored_credentials' | 'token_expired' | 'refresh_failed';
      if (!stored) {
        reason = 'no_stored_credentials';
      } else {
        const expiresAtMs = new Date(stored.expiresAt).getTime();
        reason =
          Number.isFinite(expiresAtMs) && expiresAtMs > Date.now()
            ? 'refresh_failed'
            : 'token_expired';
      }

      const loginCommand = [...CLI_INVOCATION.split(' '), 'login'];
      const resumeCommand = [...CLI_INVOCATION.split(' '), '--agent'];
      const instruction =
        reason === 'no_stored_credentials'
          ? 'Not signed in to Amplitude. Ask the user to run ' +
            `\`${loginCommand.join(' ')}\` in a terminal to authenticate, ` +
            `then re-run \`${resumeCommand.join(' ')}\` to resume.`
          : reason === 'token_expired'
          ? 'Your stored Amplitude credentials have expired. Ask the user ' +
            `to run \`${loginCommand.join(' ')}\` to refresh, then re-run ` +
            `\`${resumeCommand.join(' ')}\` to resume.`
          : // refresh_failed
            'Stored Amplitude credentials are still within their TTL but ' +
            'the wizard could not contact the auth server (network issue, ' +
            'transient 5xx, or revoked refresh token). Retry the same ' +
            `command; if it persists, run \`${loginCommand.join(' ')}\` ` +
            'to refresh.';

      agentUI.emitAuthRequired({
        reason,
        instruction,
        loginCommand,
        resumeCommand,
      });
      process.exit(ExitCode.AUTH_REQUIRED);
    }
    // CI mode falls through — runWizard will handle missing credentials
  }

  // Log what was resolved so the caller can see it
  if (mode === 'agent' && session.credentials) {
    const parts = [
      session.selectedOrgName,
      session.selectedProjectName,
      session.selectedEnvName,
    ].filter(Boolean);
    if (parts.length > 0) {
      getUI().log.info(`Using: ${parts.join(' / ')}`);
    }
  }
};

/**
 * `@returns` false when signup cannot proceed (--agent mode: emitted
 * `signup_input_required`; tests mock `process.exit` — see caller).
 */
export function gateAgentSignupArguments(
  session: import('../lib/wizard-session').WizardSession,
  agentUI: AgentUI,
): boolean {
  if (!session.signup || !session.agent) return true;

  type MissingFlag = {
    flag: string;
    description: string;
    url?: string;
  };
  const missing: MissingFlag[] = [];
  if (session.region == null) {
    missing.push({
      flag: '--region',
      description: 'Amplitude data center (us or eu)',
    });
  }
  if (!session.signupEmail) {
    missing.push({
      flag: '--email',
      description: 'Email address for the new Amplitude account',
    });
  }
  if (!session.signupFullName) {
    missing.push({
      flag: '--full-name',
      description: 'Full name on the Amplitude account',
    });
  }
  if (session.tosAccepted !== true) {
    missing.push({
      flag: '--accept-tos',
      description:
        'Agree to the Amplitude Terms of Service (' +
        TERMS_OF_SERVICE_URL +
        ')',
      url: TERMS_OF_SERVICE_URL,
    });
  }
  if (missing.length === 0) return true;

  const invocationParts = /\s/.test(CLI_INVOCATION)
    ? CLI_INVOCATION.split(' ')
    : [CLI_INVOCATION];

  agentUI.emitSignupInputsRequired({
    missing,
    resumeCommand: [
      ...invocationParts,
      '--signup',
      '--agent',
      '--install-dir',
      session.installDir,
    ],
  });
  process.exit(ExitCode.INPUT_REQUIRED);
  return false;
}

/**
 * CI signup with `--email`, `--full-name`, and `--region` requires `--accept-tos`.
 *
 * `@returns` false after invalid-args exit (caller must early-return — tests mock
 * `process.exit`).
 */
export function gateCiSignupAcceptToS(
  session: import('../lib/wizard-session').WizardSession,
): boolean {
  if (
    !session.ci ||
    !session.signup ||
    !session.signupEmail ||
    !session.signupFullName ||
    session.region == null
  ) {
    return true;
  }
  if (session.tosAccepted !== true) {
    process.stderr.write(
      `${CLI_INVOCATION}: --signup in non-interactive mode requires agreeing ` +
        `to the Amplitude Terms of Service (${TERMS_OF_SERVICE_URL}). ` +
        `Pass --accept-tos alongside --region, --email, and --full-name.\n`,
    );
    process.exit(ExitCode.INVALID_ARGS);
    return false;
  }
  return true;
}

/**
 * Run the direct-signup wrapper for agent / CI / classic modes.
 *
 * No-op when `session.signup` / `signupEmail` / `signupFullName` aren't all
 * set. On a non-null result, optionally runs `onSuccess` (classic uses this
 * to populate `session.credentials` via `resolveCredentials`). On null or
 * thrown errors, logs a human message that points at the mode's fallback
 * path (`fallbackLabel`) and returns — the caller's own auth path runs next.
 */
export const runDirectSignupIfRequested = async (
  session: import('../lib/wizard-session').WizardSession,
  fallbackLabel: string,
  onSuccess?: () => Promise<void>,
): Promise<void> => {
  if (!session.signup || !session.signupEmail || !session.signupFullName) {
    return;
  }
  const { performSignupOrAuth, trackSignupAttempt } = await import(
    '../utils/signup-or-auth.js'
  );
  const { tryResolveZone } = await import('../lib/zone-resolution.js');

  // Non-TUI modes have no RegionSelect screen to disambiguate — and the
  // backend does not route cross-region, so POSTing an EU-intending email
  // to the US provisioning endpoint would silently create the account in
  // the US data center. Require an explicit signal (--region flag, project
  // config, or stored user) before sending the signup request. Exit with
  // AUTH_REQUIRED so orchestrators see a structured failure rather than a
  // misrouted account.
  const zone = tryResolveZone(session);
  if (zone == null) {
    getUI().log.error(
      'Cannot determine data center region for --signup. Pass --region us or --region eu.',
    );
    process.exit(ExitCode.AUTH_REQUIRED);
  }
  let tokens: Awaited<ReturnType<typeof performSignupOrAuth>>;
  try {
    tokens = await performSignupOrAuth({
      email: session.signupEmail,
      fullName: session.signupFullName,
      zone,
    });
  } catch (err) {
    // Only the wrapper itself threw — emit wrapper_exception and bail.
    // Scope this catch narrowly so an `onSuccess` throw below cannot
    // re-emit telemetry after the wrapper has already recorded a
    // `success` / `user_fetch_failed` event internally.
    trackSignupAttempt({ status: 'wrapper_exception', zone });
    getUI().log.warn(
      `Direct signup errored: ${
        err instanceof Error ? err.message : String(err)
      }. Continuing to ${fallbackLabel}.`,
    );
    return;
  }
  if (tokens === null) {
    getUI().log.info(
      `Direct signup did not produce credentials; continuing to ${fallbackLabel}.`,
    );
    return;
  }
  getUI().log.info('Direct signup succeeded; using newly created account.');
  if (onSuccess) {
    try {
      await onSuccess();
    } catch (err) {
      // Signup itself succeeded — the wrapper already emitted the
      // `success` / `user_fetch_failed` event and persisted tokens.
      // If the classic-mode `resolveCredentials` (or any future
      // onSuccess caller) throws during post-signup plumbing, log it
      // but DO NOT re-emit wrapper_exception. The caller's normal
      // flow will see no credentials and recover via its own path.
      getUI().log.warn(
        `Direct signup succeeded but post-signup handling failed: ${
          err instanceof Error ? err.message : String(err)
        }. Continuing to ${fallbackLabel}.`,
      );
    }
  }
};

/**
 * Re-export shared UI bootstrap helpers so command modules don't need to
 * re-import them from disparate paths.
 */
export { getUI, setUI, LoggingUI, ExitCode, analytics };
