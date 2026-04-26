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

import { EMAIL_REGEX } from './src/lib/constants';
import { getUI } from './src/ui';
import { cleanupShellCompletionLine } from './src/utils/cleanup-shell-rc';
// Remove the broken `eval "$(amplitude-wizard completion)"` line that earlier
// versions silently appended to the user's shell rc.
cleanupShellCompletionLine();
import { analytics } from './src/utils/analytics';
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
import {
  CLI_INVOCATION,
  IS_WIZARD_DEV,
  WIZARD_VERSION,
} from './src/commands/context';
import {
  defaultCommand,
  loginCommand,
  logoutCommand,
  whoamiCommand,
  feedbackCommand,
  slackCommand,
  regionCommand,
  detectCommand,
  planCommand,
  applyCommand,
  verifyCommand,
  statusCommand,
  authCommand,
  mcpCommand,
  manifestCommand,
} from './src/commands';

const NODE_VERSION_RANGE = '>=20';

// Have to run this above the other imports because they are importing clack that
// has the problematic imports.
if (!satisfies(process.version, NODE_VERSION_RANGE)) {
  red(
    `Amplitude wizard requires Node.js ${NODE_VERSION_RANGE}. You are using Node.js ${process.version}. Please upgrade your Node.js version.`,
  );
  process.exit(1);
}

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
  })
  .command(defaultCommand)
  .command(loginCommand)
  .command(logoutCommand)
  .command(whoamiCommand)
  .command(feedbackCommand)
  .command(slackCommand)
  .command(regionCommand)
  .command(detectCommand)
  .command(planCommand)
  .command(applyCommand)
  .command(verifyCommand)
  .command(statusCommand)
  .command(authCommand)
  .command(mcpCommand)
  .command(manifestCommand)
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
    const raw = argv['app-id'] as string | number | undefined | null;
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
