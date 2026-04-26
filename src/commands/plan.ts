import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { getUI, ExitCode } from './helpers';
import { CLI_INVOCATION } from './context';

export const planCommand: CommandModule = {
  command: 'plan',
  describe:
    'Plan an Amplitude setup without making any changes (emits a plan + planId)',
  builder: (yargs) =>
    yargs.options({
      'install-dir': {
        describe: 'project directory to plan against',
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
        // `plan` never writes — opt out of the agent-implies-writes back-compat.
        requireExplicitWrites: true,
        isTTY: Boolean(process.stdout.isTTY),
      });
      try {
        const { runPlan } = await import('../lib/agent-ops.js');
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
            installDir !== process.cwd() ? ` --install-dir ${installDir}` : '';
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
};
