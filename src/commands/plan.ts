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
      // Refuse to plan from $HOME, the filesystem root, or a directory
      // with no project marker. Without this guard, the wizard runs
      // from `~/` would scan thousands of files and pollute the home
      // dir with `.amplitude/`. `--force` bypasses for power users.
      const { checkProjectGuard } = await import(
        '../utils/project-marker.js'
      );
      const guard = checkProjectGuard(installDir);
      if (!guard.ok && !argv.force) {
        if (jsonOutput) {
          process.stdout.write(
            JSON.stringify({
              v: 1,
              '@timestamp': new Date().toISOString(),
              type: 'error',
              level: 'error',
              message: `plan refused: ${guard.details}`,
              data: {
                event: 'plan_refused',
                reason: guard.reason,
                installDir,
                hint: 'Pass --install-dir <abs-path> pointing at the project root, or --force to bypass.',
              },
            }) + '\n',
          );
        } else {
          getUI().log.error(`Plan refused: ${guard.details}`);
        }
        process.exit(ExitCode.INVALID_ARGS);
      }
      try {
        const { runPlan, getAuthStatus } = await import('../lib/agent-ops.js');
        const { plan, detected } = await runPlan(installDir);

        if (jsonOutput) {
          // Emit `setup_context` BEFORE the plan envelope so an outer
          // agent reading the stream sees "you're authenticated as
          // X, working on org Y" before the proposed events arrive.
          // Best-effort — we read whatever the auth/ampli stores
          // already know. Missing fields are dropped, never invented.
          try {
            const auth = getAuthStatus();
            const { readAmpliConfig } = await import('../lib/ampli-config.js');
            const ampli = readAmpliConfig(installDir);
            const region: 'us' | 'eu' | undefined =
              auth.user?.zone === 'eu'
                ? 'eu'
                : auth.user?.zone === 'us'
                  ? 'us'
                  : undefined;
            const orgId =
              ampli.ok && ampli.config.OrgId ? ampli.config.OrgId : undefined;
            const projectId =
              ampli.ok && ampli.config.ProjectId
                ? ampli.config.ProjectId
                : undefined;
            const sources: Record<
              string,
              'auto' | 'flag' | 'saved' | 'recommended'
            > = {};
            if (region) sources.region = 'saved';
            if (orgId) sources.orgId = 'saved';
            if (projectId) sources.projectId = 'saved';
            process.stdout.write(
              JSON.stringify({
                v: 1,
                '@timestamp': new Date().toISOString(),
                type: 'lifecycle',
                message: 'setup_context (plan)',
                data_version: 1,
                data: {
                  event: 'setup_context',
                  phase: 'plan',
                  amplitude: {
                    ...(region ? { region } : {}),
                    ...(orgId ? { orgId } : {}),
                    ...(projectId ? { projectId } : {}),
                  },
                  ...(Object.keys(sources).length > 0 ? { sources } : {}),
                  // Plan never resolves an `appId` — that happens inside
                  // `apply` once env selection completes. The skill
                  // surfaces this by saying "wizard will pick an app
                  // during apply; pass --confirm-app to require an
                  // interactive choice."
                  requiresConfirmation: true,
                },
              }) + '\n',
            );
          } catch {
            // Best-effort context — never block plan emission on it.
          }
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
