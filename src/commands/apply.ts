import type { CommandModule } from 'yargs';
import { getUI, ExitCode } from './helpers';
import { CLI_INVOCATION } from './context';

export const applyCommand: CommandModule = {
  command: 'apply',
  describe:
    'Execute a previously generated plan (requires --plan-id and --yes)',
  builder: (yargs) =>
    yargs.options({
      'plan-id': {
        describe: 'plan ID returned by `amplitude-wizard plan`',
        type: 'string',
        demandOption: true,
      },
      'install-dir': {
        describe: 'project directory the plan was generated against',
        type: 'string',
      },
    }),
  handler: (argv) => {
    void (async () => {
      const { resolveMode } = await import('../lib/mode-config.js');
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

      const { resolvePlan } = await import('../lib/agent-ops.js');
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
        (argv['install-dir'] as string | undefined) ??
        planInstallDir ??
        process.cwd();

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
};
