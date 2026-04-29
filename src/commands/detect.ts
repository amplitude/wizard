import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { getUI, ExitCode } from './helpers';
import { CLI_INVOCATION } from './context';

export const detectCommand: CommandModule = {
  command: 'detect',
  describe: 'Detect the framework in the current project (outputs JSON)',
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
        const { runDetect } = await import('../lib/agent-ops.js');
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
};
