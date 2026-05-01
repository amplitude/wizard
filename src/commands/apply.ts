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
      // Pre-resolve `event_plan` so the inner agent doesn't fall into
      // its auto-approve path silently. The skill drives the agent to
      // surface the proposed events to the user, then re-invoke
      // `apply` with one of these flags. Mutually exclusive — yargs
      // treats them as boolean toggles, but if more than one is
      // passed the order below wins (approve > revise > skip), which
      // is the safest fail-open default.
      'approve-events': {
        describe:
          'pre-resolve the event_plan prompt to "approved" (skill-driven)',
        type: 'boolean',
        default: false,
      },
      'skip-events': {
        describe:
          'pre-resolve the event_plan prompt to "skipped" (no track() calls written)',
        type: 'boolean',
        default: false,
      },
      'revise-events': {
        describe:
          'pre-resolve the event_plan prompt to "revised" — pass feedback as the value',
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

      // Refuse to apply from $HOME, the filesystem root, or a directory
      // with no project marker. Mirrors the guard in `plan` — both
      // commands can mutate `installDir`, so both must check. `--force`
      // bypasses for power users running against unusual layouts.
      const { checkProjectGuard } = await import('../utils/project-marker.js');
      const guard = checkProjectGuard(installDir);
      if (!guard.ok && !mode.allowDestructive) {
        if (mode.jsonOutput) {
          process.stdout.write(
            JSON.stringify({
              v: 1,
              '@timestamp': new Date().toISOString(),
              type: 'error',
              level: 'error',
              message: `apply refused: ${guard.details}`,
              data: {
                event: 'apply_refused',
                reason: guard.reason,
                planId,
                installDir,
                hint: 'Pass --install-dir <abs-path> pointing at the project root, or --force to bypass.',
              },
            }) + '\n',
          );
        } else {
          getUI().log.error(`Apply refused: ${guard.details}`);
        }
        process.exit(ExitCode.INVALID_ARGS);
      }

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

        // Emit `setup_context` so the outer agent sees the resolved
        // Amplitude scope before the inner agent starts writing
        // anything. Best-effort — the credentials store may not have
        // an appId until env selection runs inside the spawned
        // child; skill instructs the agent to also wait for the
        // `apply_started` setup_context emitted by the child run
        // (more authoritative once env resolution completes).
        try {
          const { getAuthStatus } = await import('../lib/agent-ops.js');
          const { readAmpliConfig } = await import('../lib/ampli-config.js');
          const auth = getAuthStatus();
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
          const cliAppId =
            typeof argv['app-id'] === 'string' ||
            typeof argv['app-id'] === 'number'
              ? String(argv['app-id'])
              : undefined;
          const sources: Record<
            string,
            'auto' | 'flag' | 'saved' | 'recommended'
          > = {};
          if (region) sources.region = 'saved';
          if (orgId) sources.orgId = 'saved';
          if (projectId) sources.projectId = 'saved';
          if (cliAppId) sources.appId = 'flag';
          process.stdout.write(
            JSON.stringify({
              v: 1,
              '@timestamp': new Date().toISOString(),
              type: 'lifecycle',
              message: 'setup_context (apply_started)',
              data_version: 1,
              data: {
                event: 'setup_context',
                phase: 'apply_started',
                amplitude: {
                  ...(region ? { region } : {}),
                  ...(orgId ? { orgId } : {}),
                  ...(projectId ? { projectId } : {}),
                  ...(cliAppId ? { appId: cliAppId } : {}),
                },
                ...(Object.keys(sources).length > 0 ? { sources } : {}),
                requiresConfirmation: !cliAppId,
                ...(cliAppId
                  ? {}
                  : {
                      resumeFlags: {
                        changeApp: [
                          'apply',
                          '--plan-id',
                          planId,
                          '--app-id',
                          '<id>',
                          '--yes',
                        ],
                      },
                    }),
              },
            }) + '\n',
          );
        } catch {
          // Best-effort — never block apply on context emission.
        }
      }
      // Acquire the per-project apply lock. If another `wizard apply`
      // is already running against this install dir, refuse cleanly
      // with a `kill <pid>` hint instead of stomping its edits. The
      // skill says "never spawn a second apply" but skill text isn't
      // enforceable — this binary-side guard catches it regardless of
      // which orchestrator drove the wizard. Real-world: a Claude
      // Code transcript spawned `wizard --agent` 5 times in parallel
      // because the agent didn't know the prior runs were active.
      const { acquireApplyLock } = await import('../utils/apply-lock.js');
      const lock = acquireApplyLock(installDir, planId);
      if (!lock.ok) {
        const msg =
          `apply refused: another wizard apply is already running for ` +
          `${installDir} (pid ${lock.holder.pid}, planId ${lock.holder.planId}, ` +
          `started ${lock.holder.startedAt}). Wait for it to finish, or ` +
          `kill the prior process and retry.`;
        if (mode.jsonOutput) {
          process.stdout.write(
            JSON.stringify({
              v: 1,
              '@timestamp': new Date().toISOString(),
              type: 'error',
              level: 'error',
              message: msg,
              data: {
                event: 'apply_refused',
                reason: 'in_progress',
                planId,
                installDir,
                holder: lock.holder,
              },
            }) + '\n',
          );
        } else {
          getUI().log.error(msg);
        }
        process.exit(ExitCode.INVALID_ARGS);
      }
      // Release the lock on any exit path. Both `process.on('exit')`
      // and the explicit `child.on('exit')` below cover the spawn-
      // success and spawn-crash paths.
      process.on('exit', () => lock.release());

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

      // Pre-resolve the event_plan prompt via env vars on the
      // spawned child. The child's `AgentUI.promptEventPlan` reads
      // these and skips its auto-approve path so the orchestrator's
      // explicit user-driven decision wins. Mutually exclusive:
      // approve > revise > skip wins on conflict.
      const childEnv: Record<string, string> = {
        ...(process.env as Record<string, string>),
        AMPLITUDE_WIZARD_PLAN_ID: planId,
      };
      if (argv['approve-events']) {
        childEnv.AMPLITUDE_WIZARD_EVENT_PLAN_DECISION = 'approved';
      } else if (typeof argv['revise-events'] === 'string') {
        childEnv.AMPLITUDE_WIZARD_EVENT_PLAN_DECISION = 'revised';
        childEnv.AMPLITUDE_WIZARD_EVENT_PLAN_FEEDBACK = String(
          argv['revise-events'],
        );
      } else if (argv['skip-events']) {
        childEnv.AMPLITUDE_WIZARD_EVENT_PLAN_DECISION = 'skipped';
      }
      // Forward `--confirm-app` so the child's environment-selection
      // prompt always emits a `needs_input` for app_selection even
      // when there's a single match.
      if (argv['confirm-app']) {
        childEnv.AMPLITUDE_WIZARD_CONFIRM_APP = '1';
      }
      // Forward `installDir` so the success-exit ampli.json
      // persistence lands in the right repo.
      childEnv.AMPLITUDE_WIZARD_INSTALL_DIR = installDir;

      const child = spawn(process.execPath, args, {
        stdio: 'inherit',
        env: childEnv,
      });
      child.on('exit', (code) => process.exit(code ?? ExitCode.AGENT_FAILED));
    })();
  },
};
