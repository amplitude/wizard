import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { getUI, ExitCode } from './helpers';
import { CLI_INVOCATION } from './context';

export const authCommand: CommandModule = {
  command: 'auth <command>',
  describe: 'Manage authentication',
  builder: (yargs) =>
    yargs
      .command(
        'status',
        'Show current login state (JSON-friendly)',
        () => {},
        (argv) => {
          void (async () => {
            const { getAuthStatus } = await import('../lib/agent-ops.js');
            const { resolveMode } = await import('../lib/mode-config.js');
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
            const { getAuthToken } = await import('../lib/agent-ops.js');
            const { resolveMode } = await import('../lib/mode-config.js');
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
      .help(),
  // The handler is unused for command groups (yargs dispatches to the
  // matching subcommand). Kept as a no-op to satisfy the CommandModule type.
  handler: () => {},
};
