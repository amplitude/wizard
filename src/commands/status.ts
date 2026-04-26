import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { getUI, ExitCode } from './helpers';
import { CLI_INVOCATION } from './context';

export const statusCommand: CommandModule = {
  command: 'status',
  describe:
    'Show project setup state: framework, SDK, API key, auth (JSON-friendly)',
  builder: (yargs) =>
    yargs.options({
      'install-dir': {
        describe: 'project directory to inspect',
        type: 'string',
      },
    }),
  handler: (argv) => {
    void (async () => {
      const installDir =
        (argv['install-dir'] as string | undefined) ?? process.cwd();
      const { resolveMode } = await import('../lib/mode-config.js');
      const { jsonOutput } = resolveMode({
        json: argv.json as boolean | undefined,
        human: argv.human as boolean | undefined,
        isTTY: Boolean(process.stdout.isTTY),
      });
      try {
        const { runStatus } = await import('../lib/agent-ops.js');
        const result = await runStatus(installDir);

        if (jsonOutput) {
          process.stdout.write(JSON.stringify(result) + '\n');
        } else {
          const check = (v: boolean) => (v ? chalk.green('✔') : chalk.dim('·'));
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
};
