// Shared helpers used by multiple command modules. Extracted from the
// monolithic bin.ts so each per-command file can stay focused on its
// own builder/handler.

import { getUI, setUI } from '../ui';
import { LoggingUI } from '../ui/logging-ui';
import { ExitCode } from '../lib/exit-codes';
import { analytics } from '../utils/analytics';
import type { AmplitudeZone } from '../lib/constants';
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
 * Build a WizardSession from CLI argv, avoiding the repeated 12-field literal.
 */
export const buildSessionFromOptions = async (
  options: Record<string, unknown>,
  overrides?: { ci?: boolean },
) => {
  const { buildSession } = await import('../lib/wizard-session.js');
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
    signupEmail: options.email as string | undefined,
    signupFullName: options['full-name'] as string | undefined,
    // --region is canonical; --zone is a yargs alias, so `options.region`
    // is populated by either flag.
    region: options.region as AmplitudeZone | undefined,
    integration: options.integration as Parameters<
      typeof buildSession
    >[0]['integration'],
    benchmark: options.benchmark as boolean | undefined,
    // yargs normalizes --app-id (primary) / --project-id (alias) to `appId`.
    appId: options.appId as string | undefined,
    appName: options.appName as string | undefined,
  });
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
    session.credentials = {
      accessToken: session.apiKey,
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
  await resolveCredentials(session, {
    requireOrgId: false,
    org: options.org as string | undefined,
    env: options.env as string | undefined,
    workspaceId: options.workspaceId as string | undefined,
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
        appId: Number.parseInt(created.appId, 10) || 0,
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
      // org/workspace/app/env hierarchy. The orchestrator can either
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

  // If we still don't have credentials, auth is required
  if (!session.credentials) {
    if (mode === 'agent' && agentUI) {
      const loginCommand = [...CLI_INVOCATION.split(' '), 'login'];
      const resumeCommand = [...CLI_INVOCATION.split(' '), '--agent'];
      agentUI.emitAuthRequired({
        reason: 'no_stored_credentials',
        instruction:
          'Not signed in to Amplitude. Ask the user to run ' +
          `\`${loginCommand.join(' ')}\` in a terminal to authenticate, ` +
          `then re-run \`${resumeCommand.join(' ')}\` to resume.`,
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
      session.selectedWorkspaceName,
      session.selectedEnvName,
    ].filter(Boolean);
    if (parts.length > 0) {
      getUI().log.info(`Using: ${parts.join(' / ')}`);
    }
  }
};

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
