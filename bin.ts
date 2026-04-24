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

// Dev-mode marker: `pnpm dev` writes dist/.dev-mode after the initial build;
// `pnpm build` wipes dist/ so the marker is absent for published / prod runs.
// When present, set NODE_ENV=development so IS_DEV (src/lib/constants.ts)
// picks the dev telemetry key. Must run before any import that reads NODE_ENV
// at module-load time.
import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
if (
  process.env.NODE_ENV === undefined &&
  existsSync(resolvePath(__dirname, '.dev-mode'))
) {
  process.env.NODE_ENV = 'development';
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
} from './src/lib/observability';
import type { LogLevel } from './src/lib/observability';

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

    const zone =
      (session.region ?? session.pendingAuthCloudRegion ?? 'us') === 'eu'
        ? 'eu'
        : 'us';
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
  })
  .command(
    ['$0'],
    'Run the Amplitude setup wizard',
    (yargs) => {
      return yargs.options({
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
              // Also extracts the numeric analytics project ID for MCP event detection.
              // Fire-and-forget so it doesn't block startup.
              if (session.region && session.selectedOrgId) {
                const { getStoredUser, getStoredToken } = await import(
                  './src/utils/ampli-settings.js'
                );
                const { fetchAmplitudeUser, extractAppId } = await import(
                  './src/lib/api.js'
                );
                const storedUser = getStoredUser();
                const realUser =
                  storedUser && storedUser.id !== 'pending' ? storedUser : null;
                const zone = session.region;
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
                          region: session.region,
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
                  console.error('OAuth setup error:', err);
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

              // Best-effort flush — the 1s force-kill timer bounds the wait
              void analytics.flush().finally(() => process.exit(130));
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
          describe: 'data center region (us or eu)',
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
          console.log(
            `Logged in as ${chalk.bold(
              user.firstName + ' ' + user.lastName,
            )} <${user.email}>`,
          );
          if (user.zone !== 'us') console.log(chalk.dim(`Zone: ${user.zone}`));
        } else {
          console.log(
            chalk.yellow(
              `Not logged in. Run \`${CLI_INVOCATION} login\` to authenticate.`,
            ),
          );
        }
        process.exit(0);
      })();
    },
  )
  .command(
    'feedback',
    'Send product feedback to the Amplitude team',
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
            `Could not start region picker. Use --zone with \`${CLI_INVOCATION} login\` to set your region.`,
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
            console.log(
              `${chalk.green('✔')} Detected ${chalk.bold(
                result.frameworkName ?? result.integration,
              )} (${result.integration})`,
            );
          } else {
            console.log(
              chalk.dim(
                `No framework detected. Run \`${CLI_INVOCATION} --menu\` to pick one manually.`,
              ),
            );
          }
          process.exit(result.integration ? 0 : 1);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (jsonOutput) {
            process.stdout.write(JSON.stringify({ error: message }) + '\n');
          } else {
            console.error(chalk.red(`Detection failed: ${message}`));
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
            console.log(
              `${check(result.framework.integration !== null)} Framework: ${
                result.framework.name ?? chalk.dim('none detected')
              }`,
            );
            console.log(
              `${check(
                result.amplitudeInstalled.confidence !== 'none',
              )} Amplitude SDK: ${
                result.amplitudeInstalled.reason ?? chalk.dim('not installed')
              }`,
            );
            console.log(
              `${check(result.apiKey.configured)} API key: ${
                result.apiKey.configured
                  ? `stored in ${result.apiKey.source}`
                  : chalk.dim('not set')
              }`,
            );
            console.log(
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
            console.error(chalk.red(`Status failed: ${message}`));
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
              console.log(
                `${chalk.green('✔')} Logged in as ${chalk.bold(
                  `${result.user.firstName} ${result.user.lastName}`,
                )} <${result.user.email}>`,
              );
              console.log(chalk.dim(`  Zone: ${result.user.zone}`));
              if (result.tokenExpiresAt) {
                console.log(
                  chalk.dim(`  Token expires: ${result.tokenExpiresAt}`),
                );
              }
            } else {
              console.log(
                chalk.yellow(
                  `Not logged in. Run \`${CLI_INVOCATION} login\` to authenticate.`,
                ),
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
                console.error(
                  chalk.red(
                    `Not logged in. Run \`${CLI_INVOCATION} login\` first.`,
                  ),
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
  .recommendCommands()
  .help()
  .alias('help', 'h')
  .version()
  .alias('version', 'v')
  .wrap(process.stdout.isTTY ? yargs.terminalWidth() : 80).argv;
