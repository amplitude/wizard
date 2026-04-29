#!/usr/bin/env node
// Sanitize inherited Claude Code / Agent SDK env vars BEFORE anything else
// loads. The wizard spawns its own Claude Agent SDK subprocess and any
// transitive import that snapshots env at module init would otherwise see
// the outer session's CLAUDECODE / CLAUDE_CODE_* / CLAUDE_AGENT_SDK_* vars
// and route auth to the wrong place (400 at our LLM gateway). The project
// compiles to CommonJS (see tsconfig.build.json), so these imports execute
// inline in source order — this call must run before any import below.
import { sanitizeNestedClaudeEnv } from './src/lib/sanitize-claude-env';
sanitizeNestedClaudeEnv();

// Install EPIPE-tolerant error handlers on stdout/stderr before any
// downstream module can write. Without this, a closed receiver
// (parent process dies, output piped through `head`, outer agent
// crashes) crashes the wizard with an uncaught EPIPE. See production
// Sentry: WIZARD-CLI-8 (agent-ui emit), WIZARD-CLI-5 (afterWriteDispatched).
import { installPipeErrorHandlers } from './src/utils/pipe-errors';
installPipeErrorHandlers();

// Default NODE_ENV based on installation source. Without this, React's CJS
// entry (node_modules/react/index.js) falls through to react.development.js
// whenever NODE_ENV is unset — about 10× larger and noticeably slower on Ink
// mount. We want dev React only for actual development; everything else
// (real npx invocations, global installs, local installs) should get the
// minified production build.
//
// Resolution order (first match wins):
//   1. NODE_ENV already set        → respected (CI, vitest, pnpm scripts, ops)
//   2. dist/.dev-mode marker       → 'development' (pnpm dev writes it)
//   3. __dirname inside node_modules → 'production' (npx, global, local install)
//   4. Anything else                → 'development' (pnpm try, tsx, direct node)
//
// The path-based fallback means contributors don't have to remember to set
// NODE_ENV in package.json scripts — running `node dist/bin.js` from the
// source tree, `tsx bin.ts`, `pnpm try`, or `pnpm link --global` (the bin
// realpaths back to the repo) all stay in development. Only published
// tarballs flip to production.
//
// Must run before any import that reads NODE_ENV at module-load time.
import { existsSync } from 'node:fs';
import { resolve as resolvePath, sep as pathSep } from 'node:path';
if (process.env.NODE_ENV === undefined) {
  if (existsSync(resolvePath(__dirname, '.dev-mode'))) {
    process.env.NODE_ENV = 'development';
  } else if (__dirname.includes(`${pathSep}node_modules${pathSep}`)) {
    process.env.NODE_ENV = 'production';
  } else {
    process.env.NODE_ENV = 'development';
  }
}

import { satisfies } from 'semver';
import { red } from './src/utils/logging';
import { config as loadDotenv } from 'dotenv';
loadDotenv();

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import chalk from 'chalk';

// Honor the NO_COLOR / FORCE_COLOR standards (https://no-color.org,
// https://force-color.org) globally. Doing this at module scope ensures every
// downstream `chalk.*` call — from yargs help to LoggingUI — respects the
// user's choice. We also drop color when stdout is not a TTY, which matters
// for pipes and CI systems that capture the wizard's output.
(() => {
  if (process.env.NO_COLOR !== undefined) {
    chalk.level = 0;
    return;
  }
  if (process.env.FORCE_COLOR !== undefined) {
    // Let chalk's own FORCE_COLOR parsing win; no override needed.
    return;
  }
  if (!process.stdout.isTTY) {
    chalk.level = 0;
  }
})();

/**
 * Dev mode toggle — when set (e.g. via `pnpm try` / `pnpm dev`), internal
 * flags like --local-mcp show up in --help. End users never see them.
 */
const IS_WIZARD_DEV = process.env.AMPLITUDE_WIZARD_DEV === '1';

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
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

const NODE_VERSION_RANGE = '>=20';

// Have to run this above the other imports because they are importing clack that
// has the problematic imports.
if (!satisfies(process.version, NODE_VERSION_RANGE)) {
  red(
    `Amplitude wizard requires Node.js ${NODE_VERSION_RANGE}. You are using Node.js ${process.version}. Please upgrade your Node.js version.`,
  );
  process.exit(1);
}

import { isNonInteractiveEnvironment } from './src/utils/environment';
import { EMAIL_REGEX } from './src/lib/constants';
import type { AmplitudeZone } from './src/lib/constants';
import { getUI, setUI } from './src/ui';
import { LoggingUI } from './src/ui/logging-ui';
import { cleanupShellCompletionLine } from './src/utils/cleanup-shell-rc';
// Remove the broken `eval "$(amplitude-wizard completion)"` line that earlier
// versions silently appended to the user's shell rc.
cleanupShellCompletionLine();
import { analytics } from './src/utils/analytics';
import { ExitCode } from './src/lib/exit-codes';
import { detectNestedAgent } from './src/lib/detect-nested-agent';
import { AgentUI } from './src/ui/agent-ui';
import {
  initLogger,
  initCorrelation,
  initSentry,
  setTerminalSink,
  getLogFilePath,
  setProjectLogFile,
} from './src/lib/observability';
import type { LogLevel } from './src/lib/observability';
import { runMigrationShim } from './src/utils/storage-migration';

// Dynamic import to avoid preloading wizard-session.ts as CJS, which
// prevents the TUI's ESM dynamic imports from resolving named exports.
const lazyRunWizard = async (
  ...args: Parameters<typeof import('./src/run')['runWizard']>
) => {
  const { runWizard } = await import('./src/run.js');
  return runWizard(...args);
};

/**
 * How the user invoked this CLI — echoed back in help/error messages so we
 * don't tell `npx @amplitude/wizard` users to run `amplitude-wizard login`
 * (which only works when globally installed).
 *
 * npx stages packages under a cache path containing `/_npx/`. Everything
 * else is treated as a direct bin invocation.
 */
const CLI_INVOCATION: string = (() => {
  const scriptPath = process.argv[1] ?? '';
  if (scriptPath.includes('/_npx/') || scriptPath.includes('\\_npx\\')) {
    return 'npx @amplitude/wizard';
  }
  // npm >= 7 implements `npx` as `npm exec`, which always sets
  // npm_command=exec — even when npx resolves to an already-installed copy
  // (e.g. running `npx @amplitude/wizard` from inside this repo, or from
  // a project that depends on it). argv[1] doesn't contain /_npx/ in that
  // case, so this catches it.
  if (process.env.npm_command === 'exec') {
    return 'npx @amplitude/wizard';
  }
  return 'amplitude-wizard';
})();

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
const buildSessionFromOptions = async (
  options: Record<string, unknown>,
  overrides?: { ci?: boolean },
) => {
  const { buildSession } = await import('./src/lib/wizard-session.js');
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
  bootstrapInstallDir(session.installDir);
  return session;
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
    const { DEFAULT_HOST_URL } = await import('./src/lib/constants.js');
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
    './src/lib/credential-resolution.js'
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
    const { createAmplitudeApp, ApiError } = await import('./src/lib/api.js');
    const { getHostFromRegion } = await import('./src/utils/urls.js');
    const { persistApiKey } = await import('./src/utils/api-key-store.js');

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

    const { resolveZone } = await import('./src/lib/zone-resolution.js');
    const { DEFAULT_AMPLITUDE_ZONE } = await import('./src/lib/constants.js');
    const { toCredentialAppId } = await import('./src/lib/wizard-session.js');
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
const runDirectSignupIfRequested = async (
  session: import('./src/lib/wizard-session').WizardSession,
  fallbackLabel: string,
  onSuccess?: () => Promise<void>,
): Promise<void> => {
  if (!session.signup || !session.signupEmail || !session.signupFullName) {
    return;
  }
  const { performSignupOrAuth, trackSignupAttempt } = await import(
    './src/utils/signup-or-auth.js'
  );
  const { tryResolveZone } = await import('./src/lib/zone-resolution.js');

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

// ── Observability bootstrap ─────────────────────────────────────────
// Initialize structured logging early so all code paths can use it.
// The terminal sink routes log output through the UI singleton (getUI()),
// which may be LoggingUI, InkUI, or AgentUI depending on the mode.
{
  initCorrelation(analytics.getAnonymousId());

  // Resolve mode from argv early (before yargs parses) for logger config.
  // This is a lightweight check — full mode resolution happens in yargs handlers.
  const rawArgv = process.argv.slice(2);
  const isAgent =
    rawArgv.includes('--agent') || process.env.AMPLITUDE_WIZARD_AGENT === '1';
  if (isAgent) process.env.AMPLITUDE_WIZARD_AGENT = '1';
  const isCi =
    rawArgv.includes('--ci') ||
    rawArgv.includes('--yes') ||
    rawArgv.includes('-y');
  const isDebug =
    rawArgv.includes('--debug') || process.env.AMPLITUDE_WIZARD_DEBUG === '1';
  const isVerbose =
    rawArgv.includes('--verbose') ||
    process.env.AMPLITUDE_WIZARD_VERBOSE === '1';

  const mode = isAgent ? 'agent' : isCi ? 'ci' : 'interactive';

  initLogger({
    mode,
    debug: isDebug,
    verbose: isVerbose || isDebug,
    version: WIZARD_VERSION,
    logFile: process.env.AMPLITUDE_WIZARD_LOG,
  });

  // Initialize Sentry error tracking.
  // Respects DO_NOT_TRACK=1 and AMPLITUDE_WIZARD_NO_TELEMETRY=1 for opt-out.
  initSentry({
    sessionId: analytics.getAnonymousId(),
    version: WIZARD_VERSION,
    mode,
    debug: isDebug,
  });

  // Set session-scoped properties so every event includes mode/version/platform.
  analytics.setSessionProperty('mode', mode);
  analytics.setSessionProperty('wizard_version', WIZARD_VERSION);
  analytics.setSessionProperty('platform', process.platform);
  analytics.setSessionProperty('node_version', process.version);

  // Non-blocking background update check — prints a one-line notice on
  // stderr when a newer version is available. Auto-skips in CI / piped /
  // agent modes via shouldCheckForUpdates().
  void import('./src/utils/update-notifier.js')
    .then(({ scheduleUpdateCheck }) =>
      scheduleUpdateCheck('@amplitude/wizard', WIZARD_VERSION),
    )
    .catch(() => {});

  // Route logger terminal output through the UI singleton.
  setTerminalSink((level: LogLevel, namespace: string, msg: string) => {
    const prefix = `[${namespace}]`;
    switch (level) {
      case 'error':
        getUI().log.error(`${prefix} ${msg}`);
        break;
      case 'warn':
        getUI().log.warn(`${prefix} ${msg}`);
        break;
      case 'info':
        getUI().log.info(`${prefix} ${msg}`);
        break;
      case 'debug':
        getUI().log.info(`${prefix} ${msg}`);
        break;
    }
  });

  // Print log file path when debugging (helps users find the log)
  if (isDebug) {
    getUI().log.info(`Log file: ${getLogFilePath()}`);
  }

  // Detect nested invocation inside another Claude Code / Claude Agent SDK
  // session. Inherited env vars (CLAUDECODE, CLAUDE_CODE_*, CLAUDE_AGENT_SDK_*)
  // were already sanitized at the top of this file before any import could
  // snapshot them. This block is diagnostic-only: it surfaces the signal so
  // outer agent orchestrators can log it, and gives humans debugging auth
  // weirdness a breadcrumb.
  const nested = detectNestedAgent();
  if (nested) {
    const detail =
      `Detected nested agent invocation via ${nested.envVar}=${nested.envValue}. ` +
      `Inherited outer-agent env vars were sanitized; the setup agent will run normally.`;
    if (mode === 'agent') {
      new AgentUI().emitNestedAgent({
        signal: nested.signal,
        envVar: nested.envVar,
        instruction: detail,
        bypassEnv: 'AMPLITUDE_WIZARD_ALLOW_NESTED',
      });
    } else {
      // Surface a soft breadcrumb for interactive + CI users too, not just
      // --debug. If sanitization ever regresses, this is the only signal a
      // non-agent caller will see.
      getUI().log.info(detail);
    }
  }
}

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
  .scriptName(CLI_INVOCATION)
  .env('AMPLITUDE_WIZARD')
  // global options
  .options({
    debug: {
      default: false,
      describe: 'enable debug logging',
      type: 'boolean',
    },
    verbose: {
      default: false,
      describe: 'print extra diagnostic info to the log',
      type: 'boolean',
    },
    default: {
      default: true,
      describe: 'use default options for all prompts',
      type: 'boolean',
    },
    signup: {
      default: false,
      describe: 'create a new Amplitude account during setup',
      type: 'boolean',
    },
    'local-mcp': {
      default: false,
      // Internal dev escape hatch — points the wizard at a locally running
      // MCP server (localhost:8787). Hidden from public --help.
      describe: 'connect to a local MCP server for development',
      type: 'boolean',
      hidden: !IS_WIZARD_DEV,
    },
    ci: {
      default: false,
      describe: 'run non-interactively (for CI pipelines)',
      type: 'boolean',
    },
    'auto-approve': {
      default: false,
      describe:
        'silently pick the recommended choice on `needs_input` (no writes)',
      type: 'boolean',
    },
    yes: {
      alias: 'y',
      default: false,
      describe:
        'skip all prompts; allow the inner agent to write files (required for `apply` subcommand)',
      type: 'boolean',
    },
    force: {
      default: false,
      describe:
        'allow destructive writes (overwrite/delete existing files); implies --yes',
      type: 'boolean',
    },
    'api-key': {
      // Dev-only escape hatch. In normal flows the wizard fetches the
      // project's API key via OAuth — the user should never have to paste one.
      // Hidden from public --help unless AMPLITUDE_WIZARD_DEV=1.
      describe:
        'Amplitude API key (dev escape hatch; prefer `amplitude-wizard login`)',
      type: 'string',
      hidden: !IS_WIZARD_DEV,
    },
    'app-id': {
      // Canonical term across amplitude/amplitude (Python `app_id`) and
      // amplitude/javascript (TS `appId`). Numeric, e.g. 769610. The only
      // scope flag agents need.
      describe:
        'Amplitude app ID (numeric, e.g. 769610) — the only scope flag needed in agent mode',
      type: 'string',
      alias: 'project-id',
    },
    'app-name': {
      // `--project-name` kept as alias for existing callers; internally we
      // create an app (the canonical term in the Data API and Python models).
      describe:
        'Name for a new Amplitude app (creates one if no apps exist, or when used with --ci/--agent)',
      type: 'string',
      alias: 'project-name',
    },
    // --workspace-id / --org / --env remain parseable (yargs env fallbacks,
    // interactive legacy, CI scripts). Hidden from public help — agents should
    // use --app-id, which is globally unique and unambiguous.
    'workspace-id': {
      describe: 'Amplitude workspace ID (UUID) — legacy; prefer --app-id',
      type: 'string',
      hidden: true,
    },
    org: {
      describe: 'Amplitude org name — legacy; prefer --app-id',
      type: 'string',
      hidden: true,
    },
    env: {
      describe: 'Amplitude environment name — legacy; prefer --app-id',
      type: 'string',
      hidden: true,
    },
    json: {
      default: false,
      describe: 'emit machine-readable JSON output (implied when piped)',
      type: 'boolean',
    },
    human: {
      default: false,
      describe: 'force human-readable output (overrides --json auto-detect)',
      type: 'boolean',
    },
    email: {
      describe: 'email to use when creating a new account (requires --signup)',
      type: 'string',
      coerce: (value: string | undefined) => {
        if (value === undefined) return value;
        if (!EMAIL_REGEX.test(value)) {
          throw new Error(`Invalid email: "${value}"`);
        }
        return value;
      },
    },
    'full-name': {
      describe:
        'full name to use when creating a new account (requires --signup)',
      type: 'string',
      coerce: (value: string | undefined) => {
        if (value === undefined) return value;
        if (value.trim().length === 0) {
          throw new Error('--full-name cannot be empty');
        }
        return value;
      },
    },
    // Hidden shadows of env-only flags. .env('AMPLITUDE_WIZARD') auto-maps
    // AMPLITUDE_WIZARD_DEV / _LOG / _TOKEN / _AGENT / _INSTALL_DIR / _CLASSIC
    // to these option names; declaring them here lets .strict() accept the
    // env-var injection on every command (not just $0 where they're visible).
    dev: {
      hidden: true,
      describe: 'internal: AMPLITUDE_WIZARD_DEV env-var passthrough',
      type: 'boolean',
    },
    log: {
      hidden: true,
      describe: 'internal: AMPLITUDE_WIZARD_LOG env-var passthrough',
      type: 'string',
    },
    token: {
      hidden: true,
      describe: 'internal: AMPLITUDE_WIZARD_TOKEN env-var passthrough',
      type: 'string',
    },
    agent: {
      hidden: true,
      describe: 'internal: AMPLITUDE_WIZARD_AGENT env-var passthrough',
      type: 'boolean',
    },
    'install-dir': {
      hidden: true,
      describe: 'internal: AMPLITUDE_WIZARD_INSTALL_DIR env-var passthrough',
      type: 'string',
    },
    classic: {
      hidden: true,
      describe: 'internal: AMPLITUDE_WIZARD_CLASSIC env-var passthrough',
      type: 'boolean',
    },
    // The `apply` subcommand spawns a child wizard process and passes the
    // validated plan ID via `AMPLITUDE_WIZARD_PLAN_ID`. Without this hidden
    // shadow, .env('AMPLITUDE_WIZARD') auto-maps that env var to `planId`
    // on the default $0 command, and .strict() rejects it as unknown —
    // crashing the apply child immediately after `apply_started`.
    'plan-id': {
      hidden: true,
      describe: 'internal: AMPLITUDE_WIZARD_PLAN_ID env-var passthrough',
      type: 'string',
    },
    // AMPLITUDE_WIZARD_SKIP_BOOTSTRAP=1 disables the per-project storage
    // bootstrap (migration shim + per-project log routing). Used by the
    // CLI test harness; `.env('AMPLITUDE_WIZARD')` auto-maps it to
    // `skipBootstrap` and `.strict()` rejects it without this shadow.
    'skip-bootstrap': {
      hidden: true,
      describe: 'internal: AMPLITUDE_WIZARD_SKIP_BOOTSTRAP env-var passthrough',
      type: 'boolean',
    },
  })
  .command(
    ['$0'],
    'Run the Amplitude setup wizard',
    (yargs) => {
      return yargs.options({
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
        classic: {
          default: false,
          describe: 'use the classic prompt-based UI',
          type: 'boolean',
        },
      });
    },
    (argv) => {
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
          const { AgentUI } = await import('./src/ui/agent-ui.js');
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
      } else if (options.ci || options.yes || options.force) {
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
              './src/lib/credential-resolution.js'
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
            const { startTUI } = await import('./src/ui/tui/start-tui.js');
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
              './src/lib/graceful-exit.js'
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
              const { DEFAULT_HOST_URL } = await import(
                './src/lib/constants.js'
              );
              session.credentials = {
                accessToken: session.apiKey,
                projectApiKey: session.apiKey,
                host: DEFAULT_HOST_URL,
                appId: session.appId ?? 0,
              };
              session.projectHasData = false;
            } else {
              // Pre-populate region + credentials from stored OAuth tokens.
              const { logToFile } = await import('./src/utils/debug.js');

              // Check for crash-recovery checkpoint
              const { loadCheckpoint } = await import(
                './src/lib/session-checkpoint.js'
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
                './src/lib/credential-resolution.js'
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
                  './src/utils/ampli-settings.js'
                );
                const { fetchAmplitudeUser, extractAppId } = await import(
                  './src/lib/api.js'
                );
                const { resolveZone } = await import(
                  './src/lib/zone-resolution.js'
                );
                const { DEFAULT_AMPLITUDE_ZONE } = await import(
                  './src/lib/constants.js'
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
                          workspace_id:
                            session.selectedWorkspaceId ?? undefined,
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
                './src/lib/agent-interface.js'
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
            const { initFeatureFlags } = await import(
              './src/lib/feature-flags.js'
            );
            await initFeatureFlags().catch(() => {
              // Flag init failure is non-fatal — all flags default to off
            });

            // Apply SDK-level opt-out based on feature flags
            analytics.applyOptOut();

            // Detection (`detectAllFrameworks`), the registry, and
            // `DETECTION_TIMEOUT_MS` all moved into
            // `lib/framework-detection.ts` so the IntroScreen's "Change
            // directory" flow can re-run detection inline. bin.ts now
            // just calls the helper.
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

            // ── OAuth + account setup ──────────────────────────────
            // Runs concurrently with framework detection while AuthScreen shows.
            // When OAuth completes, store.setOAuthComplete() triggers the
            // AuthScreen SUSI pickers (org → workspace → API key).
            // AuthScreen calls store.setCredentials() when done, advancing the
            // router past Auth → RegionSelect → DataSetup → to IntroScreen.
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

            // Run a single OAuth + fetchAmplitudeUser + setOAuthComplete
            // cycle against the currently selected region. Shared between
            // the initial auth task and the re-auth watcher that handles
            // mid-session /region changes.
            const runOAuthCycle = async (
              forceFresh: boolean,
            ): Promise<void> => {
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
              const { resolveZone } = await import(
                './src/lib/zone-resolution.js'
              );

              const zone = resolveZone(
                tui.store.session,
                DEFAULT_AMPLITUDE_ZONE,
                { readDisk: false },
              );

              let auth = await performAmplitudeAuth({ zone, forceFresh });

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

              // Populate user email for /whoami display. Use the store
              // setter (not the closed-over `session` ref from line 1101) —
              // every nanostores `setKey` replaces the top-level object, so
              // by the time the re-auth watcher fires this cycle the local
              // `session` ref is many generations stale and a direct mutation
              // would silently land on a discarded object.
              tui.store.setUserEmail(userInfo.email);
              analytics.setDistinctId(userInfo.email);
              analytics.identifyUser({ email: userInfo.email });

              // Signal AuthScreen — triggers org/workspace/API key pickers
              tui.store.setOAuthComplete({
                accessToken: auth.accessToken,
                idToken: auth.idToken,
                cloudRegion,
                orgs: userInfo.orgs,
              });
            };

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
                await waitForSessionState(
                  () =>
                    tui.store.session.introConcluded &&
                    tui.store.session.region !== null,
                );
                const { resolveZone } = await import(
                  './src/lib/zone-resolution.js'
                );
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
                  './src/utils/signup-or-auth.js'
                );
                const s = tui.store.session;
                if (s.signup && s.signupEmail && s.signupFullName) {
                  const { performSignupOrAuth } = await import(
                    './src/utils/signup-or-auth.js'
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
                  // Defer to the shared runOAuthCycle helper for the
                  // common no-signup path. This keeps the initial-auth
                  // flow and the /region re-auth watcher in lockstep.
                  await runOAuthCycle(forceFresh);
                  return;
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
                      expiresAt: new Date(
                        Date.now() + 3600 * 1000,
                      ).toISOString(),
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

            // Fire-and-forget watcher that re-runs OAuth whenever a mid-session
            // /region clears credentials. Without this the user would hang on
            // AuthScreen's "Waiting for authentication..." spinner after
            // switching regions. Never resolves — the process exit (via SIGINT
            // or normal completion) tears it down.
            //
            // Deferred until authTask resolves so the watcher doesn't add a
            // second subscribe during the initial-auth window.
            void (async () => {
              await authTask;
              const { Overlay } = await import('./src/ui/tui/router.js');
              // Tracks consecutive runOAuthCycle failures so we can back off
              // and surface a hint instead of hot-looping (or going silent)
              // when the new zone's OAuth keeps failing.
              let consecutiveFailures = 0;
              while (true) {
                // Wait for credentials to be populated first — either by the
                // initial authTask above or by AuthScreen's SUSI pickers.
                await waitForSessionState(
                  () => tui.store.session.credentials !== null,
                );

                // Then wait for them to be cleared AND the user to have
                // picked a new region (so we don't fire while RegionSelect
                // is still open). setRegionForced clears credentials; the
                // subsequent setRegion clears regionForced.
                //
                // Skip when the Logout overlay is active or an outro is
                // queued — /logout clears credentials immediately and
                // process.exit()s 1.5s later; without this guard the
                // watcher would race the exit and open a browser during the
                // "Logged out" confirmation.
                //
                // The `loggingOut` session flag is set synchronously by
                // showLogoutOverlay BEFORE any state mutation. Checking it
                // closes the brief gate where credentials are null but
                // `currentScreen` has not yet re-resolved to Overlay.Logout,
                // which would otherwise let this watcher fall through and
                // trigger an unwanted runOAuthCycle.
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
                  // forceFresh: false lets performAmplitudeAuth reuse a
                  // stored per-zone token silently when the user has
                  // previously signed into the target region. Only users
                  // switching to a never-visited zone see the browser.
                  await runOAuthCycle(false);
                  consecutiveFailures = 0;
                } catch (err) {
                  consecutiveFailures += 1;
                  if (process.env.DEBUG || process.env.AMPLITUDE_WIZARD_DEBUG) {
                    console.error('Re-auth error:', err);
                  }
                  // runOAuthCycle threw before setOAuthComplete, so
                  // credentials are still null and the inner waiters above
                  // would resolve immediately on the next loop iteration —
                  // hot-spinning the OAuth attempt. Surface a hint and back
                  // off so the user sees something and a retry storm can't
                  // chew CPU. The retry loop is intentionally bounded; users
                  // can still recover via `/login` or by re-picking a region.
                  tui.store.setCommandFeedback(
                    consecutiveFailures === 1
                      ? "Authentication didn't complete. Retrying — use /login to retry manually."
                      : `Authentication failed (attempt ${consecutiveFailures}). Use /login to retry manually.`,
                    consecutiveFailures >= 3 ? 8000 : 4000,
                  );
                  if (consecutiveFailures >= 3) {
                    // After 3 strikes, stop auto-retrying so we don't burn
                    // tokens or trigger rate limits. The user can resume via
                    // /login or /region; both clear credentials and unblock
                    // the watcher.
                    await waitForSessionState(
                      () =>
                        tui.store.currentScreen === Overlay.Login ||
                        tui.store.session.regionForced,
                    );
                    consecutiveFailures = 0;
                    continue;
                  }
                  // Brief backoff before the next attempt so transient
                  // network blips have time to recover.
                  await new Promise<void>((r) =>
                    setTimeout(r, 1500 * consecutiveFailures),
                  );
                }
              }
            })();

            // ── Framework detection ────────────────────────────────
            // Runs concurrently with auth while AuthScreen shows.
            // Each detector has its own per-framework timeout internally,
            // so no outer timeout is needed. The same helper is invoked
            // again from IntroScreen when the user picks "Change
            // directory" — keeping a single implementation prevents the
            // two paths from drifting apart.
            const { runFrameworkDetection } = await import(
              './src/lib/framework-detection.js'
            );

            // Wire up an in-store re-detection trigger so the IntroScreen
            // can swap the install directory inline without bin.ts having
            // to expose a callback. The store keeps the AbortController
            // for the active run; firing a new one cancels the previous.
            tui.store.setFrameworkRedetector((nextDir, signal) =>
              runFrameworkDetection(tui.store, nextDir, { signal }),
            );

            const detectionTask = runFrameworkDetection(tui.store, installDir);

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

            // (The SIGINT handler is now installed earlier, right after
            // startTUI(), to close a race window where early Ctrl+C would
            // bypass the handler and terminate immediately.)

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
  )
  .command(
    'login',
    'Log in to your Amplitude account',
    (yargs) => {
      return yargs.options({
        region: {
          describe: 'data center region (us or eu)',
          choices: ['us', 'eu'] as const,
          default: 'us' as const,
          type: 'string',
          // `--zone` is the pre-existing name; kept as an alias so any
          // scripts using `wizard login --zone` continue to work.
          alias: 'zone',
        },
      });
    },
    (argv) => {
      void (async () => {
        setUI(new LoggingUI());
        const { performAmplitudeAuth } = await import('./src/utils/oauth.js');
        const { fetchAmplitudeUser } = await import('./src/lib/api.js');
        const { storeToken } = await import('./src/utils/ampli-settings.js');
        // `--region` is canonical; `argv.zone` is the yargs alias mirror.
        const zone = argv.region as 'us' | 'eu';

        try {
          const { getStoredUser, getStoredToken } = await import(
            './src/utils/ampli-settings.js'
          );
          // If a valid cached session exists, display the stored user without
          // re-fetching from the API (the cached idToken may be expired).
          const cachedToken = getStoredToken(undefined, zone);
          const cachedUser = cachedToken ? getStoredUser() : undefined;
          if (cachedUser && cachedUser.id !== 'pending') {
            getUI().log.success(
              `Already logged in as ${cachedUser.firstName} ${cachedUser.lastName} <${cachedUser.email}>`,
            );
            if (cachedUser.zone !== 'us') {
              getUI().note(`Zone: ${cachedUser.zone}`);
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
          getUI().log.success(
            `Logged in as ${user.firstName} ${user.lastName} <${user.email}>`,
          );
          if (user.orgs.length > 0) {
            getUI().note(`Org: ${user.orgs.map((o) => o.name).join(', ')}`);
          }
          process.exit(0);
        } catch (e) {
          getUI().log.error(
            `Login failed: ${e instanceof Error ? e.message : String(e)}`,
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
            getUI().log.success(`Logged out ${user.email}`);
          } else {
            getUI().note('No active session found.');
          }
        } catch {
          getUI().note('No active session found.');
        }
        process.exit(0);
      })();
    },
  )
  .command(
    'whoami',
    'Show the currently logged-in user',

    () => {},
    (_argv) => {
      void (async () => {
        const { getStoredUser, getStoredToken } = await import(
          './src/utils/ampli-settings.js'
        );
        const user = getStoredUser();
        const token = getStoredToken();
        if (user && token && user.id !== 'pending') {
          getUI().log.info(
            `Logged in as ${chalk.bold(
              user.firstName + ' ' + user.lastName,
            )} <${user.email}>`,
          );
          if (user.zone !== 'us') getUI().note(`Zone: ${user.zone}`);
        } else {
          getUI().log.warn(
            `Not logged in. Run \`${CLI_INVOCATION} login\` to authenticate.`,
          );
        }
        process.exit(0);
      })();
    },
  )
  .command(
    'feedback [words..]',
    'Send product feedback to the Amplitude team',
    (yargs) => {
      return yargs
        .positional('words', {
          describe: 'Feedback message (positional, space-separated)',
          type: 'string',
          array: true,
        })
        .options({
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
        const positional = Array.isArray(argv.words)
          ? argv.words.join(' ').trim()
          : '';
        const message = (fromFlag || positional).trim();
        if (!message) {
          getUI().log.error(
            `Usage: ${CLI_INVOCATION} feedback <message>  or  feedback --message <message>`,
          );
          process.exit(1);
          return;
        }
        try {
          const { trackWizardFeedback } = await import(
            './src/utils/track-wizard-feedback.js'
          );
          await trackWizardFeedback(message);
          getUI().log.success('Thanks — your feedback was sent.');
          process.exit(0);
        } catch (e) {
          getUI().log.error(
            `Feedback failed: ${e instanceof Error ? e.message : String(e)}`,
          );
          process.exit(1);
        }
      })();
    },
  )
  .command(
    'slack',
    'Connect Amplitude to Slack',
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
          // The App API validates access_tokens, not id_tokens.
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

          // Try to get the direct Slack OAuth URL from the App API.
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
    'Switch your data center region (US or EU)',
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
              idToken: storedToken.idToken,
              projectApiKey: '',
              host: getHostFromRegion(zone),
              appId: 0,
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
          // Write confirmation synchronously: Ink renders asynchronously via
          // React reconciliation, so store.pushStatus() messages would be lost
          // when process.exit(0) fires on the next line.
          if (updated) {
            console.log(
              chalk.green(
                `\n✔ Region updated to ${pickedRegion.toUpperCase()}`,
              ),
            );
          } else {
            console.log(
              chalk.dim(
                `\nRegion set to ${pickedRegion.toUpperCase()}. Run \`${CLI_INVOCATION} login\` to authenticate.`,
              ),
            );
          }
          process.exit(0);
        } catch {
          setUI(new LoggingUI());
          getUI().log.error(
            `Could not start region picker. Use --region with \`${CLI_INVOCATION} login\` to set your region.`,
          );
          process.exit(1);
        }
      })();
    },
  )
  .command(
    'detect',
    'Detect the framework in the current project (outputs JSON)',
    (yargs) => {
      return yargs.options({
        'install-dir': {
          describe: 'project directory to inspect',
          type: 'string',
        },
      });
    },
    (argv) => {
      void (async () => {
        const installDir = argv['install-dir'] ?? process.cwd();
        const { resolveMode } = await import('./src/lib/mode-config.js');
        const { jsonOutput } = resolveMode({
          json: argv.json as boolean | undefined,
          human: argv.human as boolean | undefined,
          isTTY: Boolean(process.stdout.isTTY),
        });
        try {
          const { runDetect } = await import('./src/lib/agent-ops.js');
          const result = await runDetect(installDir);

          if (jsonOutput) {
            process.stdout.write(JSON.stringify(result) + '\n');
          } else if (result.integration) {
            getUI().log.success(
              `Detected ${chalk.bold(
                result.frameworkName ?? result.integration,
              )} (${result.integration})`,
            );
          } else {
            getUI().note(
              `No framework detected. Run \`${CLI_INVOCATION} --menu\` to pick one manually.`,
            );
          }
          process.exit(result.integration ? 0 : 1);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (jsonOutput) {
            process.stdout.write(JSON.stringify({ error: message }) + '\n');
          } else {
            getUI().log.error(`Detection failed: ${message}`);
          }
          process.exit(ExitCode.GENERAL_ERROR);
        }
      })();
    },
  )
  .command(
    'plan',
    'Plan an Amplitude setup without making any changes (emits a plan + planId)',
    (yargs) => {
      return yargs.options({
        'install-dir': {
          describe: 'project directory to plan against',
          type: 'string',
        },
      });
    },
    (argv) => {
      void (async () => {
        const installDir = argv['install-dir'] ?? process.cwd();
        const { resolveMode } = await import('./src/lib/mode-config.js');
        const { jsonOutput } = resolveMode({
          json: argv.json as boolean | undefined,
          human: argv.human as boolean | undefined,
          // `plan` never writes — opt out of the agent-implies-writes back-compat.
          requireExplicitWrites: true,
          isTTY: Boolean(process.stdout.isTTY),
        });
        try {
          const { runPlan } = await import('./src/lib/agent-ops.js');
          const { plan, detected } = await runPlan(installDir);

          if (jsonOutput) {
            process.stdout.write(
              JSON.stringify({
                v: 1,
                '@timestamp': new Date().toISOString(),
                type: 'plan',
                message: detected
                  ? `plan ready: ${plan.frameworkName} (${plan.framework})`
                  : 'plan ready: no framework detected',
                data: {
                  event: 'plan',
                  planId: plan.planId,
                  framework: plan.framework,
                  frameworkName: plan.frameworkName,
                  sdk: plan.sdk,
                  events: plan.events,
                  fileChanges: plan.fileChanges,
                  requiresApproval: plan.requiresApproval,
                  resumeFlags: [
                    'apply',
                    '--plan-id',
                    plan.planId,
                    ...(installDir !== process.cwd()
                      ? ['--install-dir', installDir]
                      : []),
                    '--yes',
                  ],
                },
              }) + '\n',
            );
          } else {
            const ui = getUI();
            ui.log.info(`Plan ID: ${chalk.bold(plan.planId)}`);
            if (detected) {
              ui.log.success(
                `Detected ${chalk.bold(
                  plan.frameworkName ?? plan.framework,
                )} (SDK: ${plan.sdk ?? 'unknown'})`,
              );
            } else {
              ui.note(
                'No framework detected; the agent will fall back to Generic.',
              );
            }
            const installDirFlag =
              installDir !== process.cwd()
                ? ` --install-dir ${installDir}`
                : '';
            ui.log.info(
              `Run \`${CLI_INVOCATION} apply --plan-id ${plan.planId}${installDirFlag} --yes\` to execute.`,
            );
          }
          process.exit(ExitCode.SUCCESS);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (jsonOutput) {
            process.stdout.write(
              JSON.stringify({
                v: 1,
                '@timestamp': new Date().toISOString(),
                type: 'error',
                message: `plan failed: ${message}`,
                data: { event: 'plan_failed' },
              }) + '\n',
            );
          } else {
            getUI().log.error(`Planning failed: ${message}`);
          }
          process.exit(ExitCode.GENERAL_ERROR);
        }
      })();
    },
  )
  .command(
    'apply',
    'Execute a previously generated plan (requires --plan-id and --yes)',
    (yargs) => {
      return yargs.options({
        'plan-id': {
          describe: 'plan ID returned by `amplitude-wizard plan`',
          type: 'string',
          demandOption: true,
        },
        'install-dir': {
          describe: 'project directory the plan was generated against',
          type: 'string',
        },
      });
    },
    (argv) => {
      void (async () => {
        const { resolveMode } = await import('./src/lib/mode-config.js');
        const mode = resolveMode({
          json: argv.json as boolean | undefined,
          human: argv.human as boolean | undefined,
          yes: argv.yes as boolean | undefined,
          force: argv.force as boolean | undefined,
          autoApprove: argv['auto-approve'] as boolean | undefined,
          agent: argv.agent as boolean | undefined,
          requireExplicitWrites: true,
          isTTY: Boolean(process.stdout.isTTY),
        });

        const { resolvePlan } = await import('./src/lib/agent-ops.js');
        const planId = String(argv['plan-id']);
        const result = await resolvePlan(planId);

        // Resolve installDir with this precedence:
        //   1. Explicit `--install-dir` on this `apply` invocation (user override)
        //   2. The plan's stored `installDir` (so a cwd change between
        //      `plan` and `apply` doesn't run wizard against the wrong dir)
        //   3. process.cwd() fallback
        // The plan stores the directory it was generated against; honoring it
        // is what makes `plan` → `apply` work across cwd shifts.
        const planInstallDir =
          result.kind === 'ok' ? result.plan.installDir : undefined;
        const installDir =
          argv['install-dir'] ?? planInstallDir ?? process.cwd();

        const emitErr = (
          msg: string,
          code: ExitCode,
          extra?: Record<string, unknown>,
        ) => {
          if (mode.jsonOutput) {
            process.stdout.write(
              JSON.stringify({
                v: 1,
                '@timestamp': new Date().toISOString(),
                type: 'error',
                message: msg,
                data: { event: 'apply_failed', planId, ...extra },
              }) + '\n',
            );
          } else {
            getUI().log.error(msg);
          }
          process.exit(code);
        };

        if (result.kind === 'not_found') {
          emitErr(
            `apply failed: no plan with id ${planId}. Run \`${CLI_INVOCATION} plan\` first.`,
            ExitCode.INVALID_ARGS,
            { reason: 'not_found' },
          );
          return;
        }
        if (result.kind === 'invalid') {
          emitErr(
            `apply failed: plan ${planId} is invalid (${result.reason}).`,
            ExitCode.INVALID_ARGS,
            { reason: 'invalid' },
          );
          return;
        }
        if (result.kind === 'expired') {
          emitErr(
            `apply failed: plan ${planId} has expired (created ${result.createdAt}). Run \`${CLI_INVOCATION} plan\` again.`,
            ExitCode.INVALID_ARGS,
            { reason: 'expired', createdAt: result.createdAt },
          );
          return;
        }

        if (!mode.allowWrites) {
          emitErr(
            `apply requires --yes (or --force). Re-run: \`${CLI_INVOCATION} apply --plan-id ${planId} --yes\`.`,
            ExitCode.WRITE_REFUSED,
            { reason: 'writes_not_granted' },
          );
          return;
        }

        // Plan validated and writes granted — fall through to the regular
        // wizard run, scoped to the plan's installDir + framework hint.
        if (mode.jsonOutput) {
          process.stdout.write(
            JSON.stringify({
              v: 1,
              '@timestamp': new Date().toISOString(),
              type: 'lifecycle',
              message: `applying plan ${planId}`,
              data: {
                event: 'apply_started',
                planId,
                framework: result.plan.framework,
              },
            }) + '\n',
          );
        }
        // Force agent mode for `apply` so the run is non-interactive.
        // The full run wiring (passing the plan into the agent prompt) is
        // a follow-up — for now, apply runs the standard wizard with
        // agent-mode + writes granted, which is the same behavior as
        // `--agent --yes` today, plus a validated planId for audit.
        const { spawn } = await import('child_process');
        const args = [
          process.argv[1] ?? '',
          '--agent',
          '--yes',
          '--install-dir',
          installDir,
        ];
        if (mode.allowDestructive) args.push('--force');
        const child = spawn(process.execPath, args, {
          stdio: 'inherit',
          env: {
            ...process.env,
            AMPLITUDE_WIZARD_PLAN_ID: planId,
          },
        });
        child.on('exit', (code) => process.exit(code ?? ExitCode.AGENT_FAILED));
      })();
    },
  )
  .command(
    'projects <command>',
    "Inspect the authenticated user's Amplitude projects",
    (yargs) => {
      return yargs
        .command(
          'list',
          'List accessible projects/environments (paginated, searchable)',
          (yargs) => {
            return yargs.options({
              query: {
                describe:
                  'case-insensitive substring filter (matches org, workspace, env, app id)',
                type: 'string',
              },
              limit: {
                describe: 'page size (default 25, max 200)',
                type: 'number',
                default: 25,
              },
              offset: {
                describe: 'page offset (default 0)',
                type: 'number',
                default: 0,
              },
            });
          },
          (argv) => {
            void (async () => {
              const { resolveMode } = await import('./src/lib/mode-config.js');
              const { jsonOutput } = resolveMode({
                json: argv.json as boolean | undefined,
                human: argv.human as boolean | undefined,
                agent: argv.agent as boolean | undefined,
                requireExplicitWrites: true,
                isTTY: Boolean(process.stdout.isTTY),
              });
              try {
                const { runProjectsList } = await import(
                  './src/lib/agent-ops.js'
                );
                const offset = (argv.offset as number | undefined) ?? 0;
                const limit = (argv.limit as number | undefined) ?? 25;
                const result = await runProjectsList({
                  query: argv.query,
                  limit,
                  offset,
                });

                if (jsonOutput) {
                  // Emit a `needs_input`-shaped envelope so outer agents can
                  // render the same picker they would for the inline prompt.
                  const hasMore = offset + result.returned < result.total;
                  // Use `result.returned`, not the user-supplied `limit`, so
                  // an over-the-cap value (e.g. `--limit 9999` clamped to
                  // 200 internally) doesn't skip past unread items.
                  const nextOffset = offset + result.returned;
                  process.stdout.write(
                    JSON.stringify({
                      v: 1,
                      '@timestamp': new Date().toISOString(),
                      type: 'needs_input',
                      message: result.warning
                        ? result.warning
                        : `${result.total} project${
                            result.total === 1 ? '' : 's'
                          } available${
                            result.query ? ` matching "${result.query}"` : ''
                          }.`,
                      ...(result.warning && { level: 'warn' }),
                      data: {
                        event: 'needs_input',
                        code: 'project_selection',
                        ui: {
                          component: 'searchable_select',
                          priority: 'required',
                          title: 'Select an Amplitude project',
                          description:
                            'Choose where events from this app should be sent.',
                          searchPlaceholder:
                            'Search projects, orgs, workspaces, environments…',
                          emptyState:
                            'No projects matched. Try a different query, or run `wizard login` if you expected results.',
                        },
                        choices: result.choices.map((c) => ({
                          value: c.appId,
                          label: c.label,
                          description: c.description,
                          hint: c.envName,
                          metadata: {
                            orgId: c.orgId,
                            orgName: c.orgName,
                            workspaceId: c.workspaceId,
                            workspaceName: c.workspaceName,
                            envName: c.envName,
                            appId: c.appId,
                            rank: c.rank,
                          },
                          resumeFlags: c.resumeFlags,
                        })),
                        recommended: result.choices[0]?.appId,
                        recommendedReason: result.choices[0]
                          ? `Highest-ranked environment in the first matching workspace (${result.choices[0].description}).`
                          : undefined,
                        responseSchema: {
                          appId: 'string (required, from choices[].value)',
                        },
                        pagination: {
                          total: result.total,
                          returned: result.returned,
                          ...(result.query && { query: result.query }),
                          ...(hasMore && {
                            nextCommand: [
                              'npx',
                              '@amplitude/wizard',
                              'projects',
                              'list',
                              '--agent',
                              '--offset',
                              String(nextOffset),
                              '--limit',
                              String(limit),
                              ...(result.query
                                ? ['--query', result.query]
                                : []),
                            ],
                          }),
                        },
                        allowManualEntry: true,
                        manualEntry: {
                          flag: '--app-id',
                          placeholder: 'Enter Amplitude app ID (e.g. 769610)',
                          pattern: '^\\d+$',
                        },
                      },
                    }) + '\n',
                  );
                } else {
                  const ui = getUI();
                  if (result.warning) {
                    ui.log.warn(result.warning);
                  } else if (result.total === 0) {
                    ui.note(
                      `No projects matched${
                        result.query ? ` "${result.query}"` : ''
                      }.`,
                    );
                  } else {
                    ui.log.info(
                      `${result.total} project${result.total === 1 ? '' : 's'}${
                        result.query ? ` matching "${result.query}"` : ''
                      }:`,
                    );
                    for (const c of result.choices) {
                      ui.log.info(`  ${chalk.bold(c.appId)}  ${c.label}`);
                    }
                    if (offset + result.returned < result.total) {
                      ui.log.info(
                        chalk.dim(
                          `  … ${
                            result.total - result.returned - offset
                          } more — pass --offset and --limit to page.`,
                        ),
                      );
                    }
                  }
                }
                process.exit(
                  result.warning ? ExitCode.AUTH_REQUIRED : ExitCode.SUCCESS,
                );
              } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                if (jsonOutput) {
                  process.stdout.write(
                    JSON.stringify({
                      v: 1,
                      '@timestamp': new Date().toISOString(),
                      type: 'error',
                      message: `projects list failed: ${message}`,
                      data: { event: 'projects_list_failed' },
                    }) + '\n',
                  );
                } else {
                  getUI().log.error(`Projects list failed: ${message}`);
                }
                process.exit(ExitCode.GENERAL_ERROR);
              }
            })();
          },
        )
        .demandCommand(1, 'You must specify a subcommand: `projects list`');
    },
    () => {
      // Sub-command dispatcher; demandCommand handles the no-op case.
    },
  )
  .command(
    'verify',
    'Verify a project setup without running the agent (SDK + API key + framework checks)',
    (yargs) => {
      return yargs.options({
        'install-dir': {
          describe: 'project directory to verify',
          type: 'string',
        },
      });
    },
    (argv) => {
      void (async () => {
        const installDir = argv['install-dir'] ?? process.cwd();
        const { resolveMode } = await import('./src/lib/mode-config.js');
        const { jsonOutput } = resolveMode({
          json: argv.json as boolean | undefined,
          human: argv.human as boolean | undefined,
          requireExplicitWrites: true,
          isTTY: Boolean(process.stdout.isTTY),
        });
        try {
          const { runVerify } = await import('./src/lib/agent-ops.js');
          const result = await runVerify(installDir);
          if (jsonOutput) {
            process.stdout.write(
              JSON.stringify({
                v: 1,
                '@timestamp': new Date().toISOString(),
                type: 'result',
                message:
                  result.outcome === 'pass'
                    ? 'verify: pass'
                    : `verify: fail (${result.failures.length} issue${
                        result.failures.length === 1 ? '' : 's'
                      })`,
                data: { event: 'verification_result', ...result },
              }) + '\n',
            );
          } else {
            const ui = getUI();
            if (result.outcome === 'pass') {
              ui.log.success('Verification passed.');
            } else {
              ui.log.error('Verification failed:');
              for (const f of result.failures) ui.log.error(`  • ${f}`);
            }
          }
          process.exit(
            result.outcome === 'pass'
              ? ExitCode.SUCCESS
              : ExitCode.GENERAL_ERROR,
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (jsonOutput) {
            process.stdout.write(
              JSON.stringify({
                v: 1,
                '@timestamp': new Date().toISOString(),
                type: 'error',
                message: `verify failed: ${message}`,
                data: { event: 'verification_failed' },
              }) + '\n',
            );
          } else {
            getUI().log.error(`Verification failed: ${message}`);
          }
          process.exit(ExitCode.GENERAL_ERROR);
        }
      })();
    },
  )
  .command(
    'status',
    'Show project setup state: framework, SDK, API key, auth (JSON-friendly)',
    (yargs) => {
      return yargs.options({
        'install-dir': {
          describe: 'project directory to inspect',
          type: 'string',
        },
      });
    },
    (argv) => {
      void (async () => {
        const installDir = argv['install-dir'] ?? process.cwd();
        const { resolveMode } = await import('./src/lib/mode-config.js');
        const { jsonOutput } = resolveMode({
          json: argv.json as boolean | undefined,
          human: argv.human as boolean | undefined,
          isTTY: Boolean(process.stdout.isTTY),
        });
        try {
          const { runStatus } = await import('./src/lib/agent-ops.js');
          const result = await runStatus(installDir);

          if (jsonOutput) {
            process.stdout.write(JSON.stringify(result) + '\n');
          } else {
            const check = (v: boolean) =>
              v ? chalk.green('✔') : chalk.dim('·');
            const ui = getUI();
            ui.log.info(
              `${check(result.framework.integration !== null)} Framework: ${
                result.framework.name ?? chalk.dim('none detected')
              }`,
            );
            ui.log.info(
              `${check(
                result.amplitudeInstalled.confidence !== 'none',
              )} Amplitude SDK: ${
                result.amplitudeInstalled.reason ?? chalk.dim('not installed')
              }`,
            );
            ui.log.info(
              `${check(result.apiKey.configured)} API key: ${
                result.apiKey.configured
                  ? `stored in ${result.apiKey.source}`
                  : chalk.dim('not set')
              }`,
            );
            ui.log.info(
              `${check(result.auth.loggedIn)} Logged in: ${
                result.auth.loggedIn
                  ? `${result.auth.email} (${result.auth.zone})`
                  : chalk.dim(`run \`${CLI_INVOCATION} login\``)
              }`,
            );
          }
          process.exit(0);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (jsonOutput) {
            process.stdout.write(JSON.stringify({ error: message }) + '\n');
          } else {
            getUI().log.error(`Status failed: ${message}`);
          }
          process.exit(ExitCode.GENERAL_ERROR);
        }
      })();
    },
  )
  .command('auth <command>', 'Manage authentication', (yargs) => {
    return yargs
      .command(
        'status',
        'Show current login state (JSON-friendly)',
        () => {},
        (argv) => {
          void (async () => {
            const { getAuthStatus } = await import('./src/lib/agent-ops.js');
            const { resolveMode } = await import('./src/lib/mode-config.js');
            const { jsonOutput } = resolveMode({
              json: argv.json as boolean | undefined,
              human: argv.human as boolean | undefined,
              isTTY: Boolean(process.stdout.isTTY),
            });
            const result = getAuthStatus();

            if (jsonOutput) {
              process.stdout.write(JSON.stringify(result) + '\n');
            } else if (result.loggedIn && result.user) {
              getUI().log.success(
                `Logged in as ${chalk.bold(
                  `${result.user.firstName} ${result.user.lastName}`,
                )} <${result.user.email}>`,
              );
              getUI().note(`Zone: ${result.user.zone}`);
              if (result.tokenExpiresAt) {
                getUI().note(`Token expires: ${result.tokenExpiresAt}`);
              }
            } else {
              getUI().log.warn(
                `Not logged in. Run \`${CLI_INVOCATION} login\` to authenticate.`,
              );
            }
            process.exit(result.loggedIn ? 0 : ExitCode.AUTH_REQUIRED);
          })();
        },
      )
      .command(
        'token',
        'Print the stored OAuth access token to stdout',
        () => {},
        (argv) => {
          void (async () => {
            const { getAuthToken } = await import('./src/lib/agent-ops.js');
            const { resolveMode } = await import('./src/lib/mode-config.js');
            const { jsonOutput } = resolveMode({
              json: argv.json as boolean | undefined,
              human: argv.human as boolean | undefined,
              isTTY: Boolean(process.stdout.isTTY),
            });
            const result = getAuthToken();

            if (!result.token) {
              if (jsonOutput) {
                process.stdout.write(
                  JSON.stringify({
                    error: 'not logged in',
                    code: 'AUTH_REQUIRED',
                  }) + '\n',
                );
              } else {
                getUI().log.error(
                  `Not logged in. Run \`${CLI_INVOCATION} login\` first.`,
                );
              }
              process.exit(ExitCode.AUTH_REQUIRED);
            }

            if (jsonOutput) {
              process.stdout.write(JSON.stringify(result) + '\n');
            } else {
              // Raw token on stdout so `$(amplitude-wizard auth token)` works
              process.stdout.write(result.token + '\n');
            }
            process.exit(0);
          })();
        },
      )
      .demandCommand(1, 'You must specify a subcommand (status or token)')
      .help();
  })
  .command('mcp <command>', 'Manage the Amplitude MCP server', (yargs) => {
    return yargs
      .command(
        'add',
        'Install the Amplitude MCP server into your editor',
        (yargs) => {
          return yargs.options({
            local: {
              default: false,
              describe: 'use a local MCP server for development',
              type: 'boolean',
              hidden: !IS_WIZARD_DEV,
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
        'Remove the Amplitude MCP server from your editor',
        (yargs) => {
          return yargs.options({
            local: {
              default: false,
              describe: 'remove a local MCP server',
              type: 'boolean',
              hidden: !IS_WIZARD_DEV,
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
      .command(
        'serve',
        'Run the Amplitude wizard MCP server on stdio (for AI coding agents)',
        () => {},
        () => {
          void (async () => {
            try {
              const { startAgentMcpServer } = await import(
                './src/lib/wizard-mcp-server.js'
              );
              await startAgentMcpServer();
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              process.stderr.write(
                `${CLI_INVOCATION} mcp serve: failed to start: ${msg}\n`,
              );
              process.exit(1);
            }
          })();
        },
      )
      .demandCommand(1, 'You must specify a subcommand (add, remove, or serve)')
      .help();
  })
  .command(
    'manifest',
    'Print a machine-readable description of the CLI (for AI agents)',
    () => {},
    () => {
      void (async () => {
        const { getAgentManifest } = await import(
          './src/lib/agent-manifest.js'
        );
        process.stdout.write(
          JSON.stringify(getAgentManifest(), null, 2) + '\n',
        );
        process.exit(0);
      })();
    },
  )
  .example('$0', 'Run the interactive setup wizard')
  .example('$0 --ci --install-dir .', 'Run in CI mode (OAuth + auto-select)')
  .example(
    '$0 --agent --app-id <id> --install-dir .',
    'Run with structured NDJSON output for automation',
  )
  .example('$0 detect --json', 'Detect the framework; output JSON')
  .example('$0 status --json', 'Report project setup state as JSON')
  .example('$0 auth token', 'Print the stored OAuth token (for scripts/agents)')
  .example('$0 manifest', 'Dump the machine-readable CLI manifest as JSON')
  .epilogue(
    [
      'Environment variables:',
      '  AMPLITUDE_WIZARD_API_KEY     Amplitude project API key (alias of --api-key)',
      '  AMPLITUDE_TOKEN              OAuth access-token override (requires prior login)',
      '  AMPLITUDE_WIZARD_TOKEN       Alias for AMPLITUDE_TOKEN',
      '  AMPLITUDE_WIZARD_AGENT=1     Force agent mode (NDJSON output, auto-approve)',
      '  AMPLITUDE_WIZARD_DEBUG=1     Enable debug logging',
      '  AMPLITUDE_WIZARD_LOG=<path>  Write logs to this file',
      '',
      'Docs:      https://github.com/amplitude/wizard',
      `Feedback:  ${CLI_INVOCATION} feedback`,
    ].join('\n'),
  )
  // Validate --app-id is numeric so a typo like `--app-id=foo` fails fast with
  // a yargs-native error instead of becoming `0` downstream.
  .check((argv) => {
    const raw = argv['app-id'];
    if (raw === undefined || raw === null || raw === '') return true;
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      throw new Error(
        `--app-id must be a positive integer (received: ${String(raw)})`,
      );
    }
    return true;
  })
  // Reject unknown flags and subcommands. Catches typos like `--app-ids` or
  // `--instal-dir` that would otherwise silently fall through. Middleware for
  // consolidating credential resolution is paired with the bin.ts command-
  // module split (see TODOs).
  .strict()
  .recommendCommands()
  .help()
  .alias('help', 'h')
  .version()
  .alias('version', 'v')
  .wrap(process.stdout.isTTY ? yargs.terminalWidth() : 80).argv;
