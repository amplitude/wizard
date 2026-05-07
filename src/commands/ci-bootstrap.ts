import type { CommandModule } from 'yargs';
import { spawnSync } from 'node:child_process';
import * as readline from 'node:readline';
import chalk from 'chalk';
import { getUI, setUI, LoggingUI, ExitCode } from './helpers';
import { CLI_INVOCATION } from './context';

/**
 * Default repository receiving the rotated CI secrets. Overridable via
 * `--repo <owner/name>` so contributors can target a fork during testing.
 */
const DEFAULT_REPO = 'amplitude/wizard';

/** Names of the four CI secrets / variables this command writes. */
const SECRET_NAMES = {
  accessToken: 'WIZARD_OAUTH_TOKEN',
  refreshToken: 'WIZARD_REFRESH_TOKEN',
  expiresAt: 'WIZARD_EXPIRES_AT',
  zone: 'WIZARD_ZONE',
} as const;

/**
 * Minimal shape we need from the stored OAuth session. The wider session
 * carries id_token + user metadata too, but the CI workflow only needs
 * these four fields to refresh and reauthorize.
 */
export interface CiBootstrapSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  zone: 'us' | 'eu';
}

/** Injectable side-effecting deps so the command stays unit-testable. */
export interface CiBootstrapDeps {
  /** Returns the freshest stored OAuth session, or null if not logged in. */
  loadSession: () =>
    | CiBootstrapSession
    | null
    | Promise<CiBootstrapSession | null>;
  /** Runs `gh secret set` (or equivalent). Throws on non-zero exit. */
  setSecret: (name: string, value: string, repo: string) => void;
  /** Runs `gh variable set` (or equivalent). Throws on non-zero exit. */
  setVariable: (name: string, value: string, repo: string) => void;
  /** Asks the user [y/N]. */
  confirm: (prompt: string) => Promise<boolean>;
  /** Prints an info-level message. */
  info: (msg: string) => void;
  /** Prints an error-level message. */
  error: (msg: string) => void;
}

/**
 * Pushes the four CI secrets to the configured repo using injected deps.
 * Returns the exit code so the CLI handler can `process.exit` once.
 */
export async function runCiBootstrap(
  deps: CiBootstrapDeps,
  options: { repo: string; yes: boolean },
): Promise<number> {
  const session = await deps.loadSession();
  if (!session) {
    deps.error(
      `No stored Amplitude session found. Run \`${CLI_INVOCATION} login\` first.`,
    );
    return ExitCode.AUTH_REQUIRED;
  }
  if (!session.refreshToken) {
    deps.error(
      'Stored session has no refresh token. The hourly refresh workflow ' +
        'requires one — sign in again with ' +
        `\`${CLI_INVOCATION} login\` to mint a fresh refresh token.`,
    );
    return ExitCode.AUTH_REQUIRED;
  }

  deps.info(
    `About to push 3 secrets + 1 variable to ${chalk.bold(options.repo)}:\n` +
      `  - ${SECRET_NAMES.accessToken}  (secret)\n` +
      `  - ${SECRET_NAMES.refreshToken}  (secret)\n` +
      `  - ${SECRET_NAMES.expiresAt}  (secret)\n` +
      `  - ${SECRET_NAMES.zone}  (variable)`,
  );

  if (!options.yes) {
    const ok = await deps.confirm('Continue?');
    if (!ok) {
      deps.info('Aborted; no secrets were written.');
      return ExitCode.SUCCESS;
    }
  }

  try {
    deps.setSecret(SECRET_NAMES.accessToken, session.accessToken, options.repo);
    deps.setSecret(
      SECRET_NAMES.refreshToken,
      session.refreshToken,
      options.repo,
    );
    deps.setSecret(SECRET_NAMES.expiresAt, session.expiresAt, options.repo);
    deps.setVariable(SECRET_NAMES.zone, session.zone, options.repo);
  } catch (err) {
    deps.error(
      `Failed to write secret: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return ExitCode.NETWORK_ERROR;
  }

  deps.info(
    chalk.green('Bootstrap complete.') +
      ` The refresh workflow will keep these secrets fresh every hour.\n` +
      `Initial expiry: ${session.expiresAt}\n\n` +
      chalk.bold('Next step:') +
      ` create a fine-grained PAT with \`secrets:write\` scope on ${options.repo} ` +
      'and store it as the WIZARD_SECRET_REFRESH_PAT secret. The default ' +
      'GITHUB_TOKEN cannot write repo secrets.',
  );
  return ExitCode.SUCCESS;
}

/** Default loader: read the canonical wizard OAuth session file. */
async function defaultLoadSession(): Promise<CiBootstrapSession | null> {
  // Dynamic import (the rest of the codebase compiles to CommonJS via
  // tsc, but ampli-settings.js is loaded lazily everywhere to keep the
  // cold-start path cheap — same pattern as login / whoami).
  const settings = await import('../utils/ampli-settings.js');
  const user = settings.getStoredUser();
  if (!user) return null;
  const token = settings.getStoredToken(undefined, user.zone);
  if (!token) return null;
  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: token.expiresAt,
    zone: user.zone === 'eu' ? 'eu' : 'us',
  };
}

/** Default secret writer: shells out to `gh secret set`. */
function defaultSetSecret(name: string, value: string, repo: string): void {
  // `gh secret set NAME --repo OWNER/REPO`. We pass the value via stdin
  // to avoid leaking it into the OS process listing.
  const result = spawnSync('gh', ['secret', 'set', name, '--repo', repo], {
    input: value,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        '`gh` CLI not found on PATH. Install GitHub CLI ' +
          '(https://cli.github.com) and run `gh auth login` before retrying.',
      );
    }
    throw result.error;
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(
      `gh secret set ${name} exited with status ${result.status}`,
    );
  }
}

/** Default variable writer: shells out to `gh variable set`. */
function defaultSetVariable(name: string, value: string, repo: string): void {
  const result = spawnSync('gh', ['variable', 'set', name, '--repo', repo], {
    input: value,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        '`gh` CLI not found on PATH. Install GitHub CLI ' +
          '(https://cli.github.com) and run `gh auth login` before retrying.',
      );
    }
    throw result.error;
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(
      `gh variable set ${name} exited with status ${result.status}`,
    );
  }
}

/** Default y/N confirm — reads a single line from stdin. */
function defaultConfirm(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(`${prompt} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

export const ciBootstrapCommand: CommandModule = {
  command: 'ci-bootstrap',
  describe:
    'Push the current OAuth session to GitHub repo secrets so the hourly refresh workflow can keep them alive',
  builder: (yargs) =>
    yargs.options({
      repo: {
        describe: 'GitHub repo to push secrets to (owner/name)',
        default: DEFAULT_REPO,
        type: 'string',
      },
      yes: {
        alias: 'y',
        describe: 'skip the confirmation prompt',
        default: false,
        type: 'boolean',
      },
    }),
  handler: (argv) => {
    void (async () => {
      setUI(new LoggingUI());
      const repo = (argv.repo as string | undefined)?.trim() || DEFAULT_REPO;
      const yes = Boolean(argv.yes);

      const exitCode = await runCiBootstrap(
        {
          loadSession: defaultLoadSession,
          setSecret: defaultSetSecret,
          setVariable: defaultSetVariable,
          confirm: defaultConfirm,
          info: (msg) => getUI().log.info(msg),
          error: (msg) => getUI().log.error(msg),
        },
        { repo, yes },
      );
      process.exit(exitCode);
    })();
  },
};
