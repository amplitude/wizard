import type { CommandModule } from 'yargs';
import {
  getUI,
  ExitCode,
  getInstallDirFromArgv,
  resolveJsonOutput,
} from './helpers';

export const verifyCommand: CommandModule = {
  command: 'verify',
  describe:
    'Verify a project setup without running the agent (SDK + API key + framework checks)',
  builder: (yargs) =>
    yargs.options({
      'install-dir': {
        describe: 'project directory to verify',
        type: 'string',
      },
    }),
  handler: (argv) => {
    void (async () => {
      const installDir = getInstallDirFromArgv(argv);
      const jsonOutput = await resolveJsonOutput(argv, {
        requireExplicitWrites: true,
      });
      try {
        const { runVerify } = await import('../lib/agent-ops.js');
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
          result.outcome === 'pass' ? ExitCode.SUCCESS : ExitCode.GENERAL_ERROR,
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
};
