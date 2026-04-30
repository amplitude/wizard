import type { CommandModule } from 'yargs';
import { getUI, ExitCode } from './helpers';

/**
 * `wizard go` — one-shot plan + apply in a single streaming process.
 *
 * Equivalent to running `plan` and then `apply --plan-id <id>
 * --confirm-app --approve-events --yes`, but in one process so an
 * outer agent (Claude Code, Cursor) doesn't pay the npx cold-start
 * twice. The agent still sees the same NDJSON event stream:
 *   - `setup_context (go)` — phase metadata
 *   - `go_plan` — combined plan envelope (planId, framework, events)
 *   - then the standard apply event stream from the spawned child
 *     (setup_context apply_started, inner_agent_started,
 *      file_change_*, setup_complete, run_completed)
 *
 * For user-driven flows where the skill must surface the proposed
 * events first, the explicit `plan` → `apply` separation still works
 * unchanged. Use `go` for scripted / one-shot / "I already approved
 * this" flows; use the split for "I need to show the user the plan
 * before they commit."
 */
export const goCommand: CommandModule = {
  command: 'go',
  describe:
    "One-shot setup: plan + apply in a single streaming pipe. Equivalent to running `plan` then `apply --confirm-app --approve-events --yes`, but in one process so an outer agent doesn't pay the npx cold-start twice.",
  builder: (yargs) =>
    yargs.options({
      'install-dir': {
        describe: 'project directory to set up',
        type: 'string',
      },
      'app-id': {
        describe:
          'Amplitude app id to write events into. If omitted, the wizard will still ask via needs_input (--confirm-app is implicit for `go`).',
        type: 'string',
      },
      'event-decision': {
        // The skill ALWAYS surfaces the event plan to the user before
        // running `go` — but for fully-automated CI / scripted use we
        // accept a one-shot decision flag too. Default 'approved' is
        // the conservative happy-path: if the caller explicitly chose
        // `go`, they're saying "do the whole flow without stopping at
        // event_plan."
        describe:
          'pre-resolve the event_plan prompt: approved | skipped | revised',
        type: 'string',
        choices: ['approved', 'skipped', 'revised'] as const,
        default: 'approved',
      },
      'revise-feedback': {
        describe:
          'feedback string when --event-decision=revised; ignored otherwise',
        type: 'string',
      },
    }),
  handler: (argv) => {
    void (async () => {
      const installDir =
        (argv['install-dir'] as string | undefined) ?? process.cwd();
      const { resolveMode } = await import('../lib/mode-config.js');
      const mode = resolveMode({
        json: argv.json as boolean | undefined,
        human: argv.human as boolean | undefined,
        // `go` writes by definition — granting writes is implicit. The
        // user opted into a one-shot flow.
        yes: true,
        force: argv.force as boolean | undefined,
        autoApprove: argv['auto-approve'] as boolean | undefined,
        agent: argv.agent as boolean | undefined,
        requireExplicitWrites: false,
        isTTY: Boolean(process.stdout.isTTY),
      });

      // Project-marker guard mirrors `plan`/`apply` — refuse from $HOME,
      // filesystem root, or any directory without a project manifest.
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
              message: `go refused: ${guard.details}`,
              data: {
                event: 'go_refused',
                reason: guard.reason,
                installDir,
                hint: 'Pass --install-dir <abs-path> pointing at the project root, or --force to bypass.',
              },
            }) + '\n',
          );
        } else {
          getUI().log.error(`Go refused: ${guard.details}`);
        }
        process.exit(ExitCode.INVALID_ARGS);
      }

      // Step 1: plan in-process (no spawn, no cold start) so the agent
      // sees the proposed events before the apply phase begins. Emit a
      // single combined `go_plan` event — keeps the stream readable
      // for an outer agent following along.
      try {
        const { runPlan, getAuthStatus } = await import('../lib/agent-ops.js');
        const { plan } = await runPlan(installDir);

        if (mode.jsonOutput) {
          // Emit setup_context (go) up front so the agent can show the
          // user "you're authenticated as X" before the plan envelope.
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
            const cliAppId =
              typeof argv['app-id'] === 'string' ? argv['app-id'] : undefined;
            const sources: Record<
              string,
              'auto' | 'flag' | 'saved' | 'recommended'
            > = {};
            if (region) sources.region = 'saved';
            if (orgId) sources.orgId = 'saved';
            if (cliAppId) sources.appId = 'flag';
            process.stdout.write(
              JSON.stringify({
                v: 1,
                '@timestamp': new Date().toISOString(),
                type: 'lifecycle',
                message: 'setup_context (go)',
                data_version: 1,
                data: {
                  event: 'setup_context',
                  phase: 'plan',
                  amplitude: {
                    ...(region ? { region } : {}),
                    ...(orgId ? { orgId } : {}),
                    ...(cliAppId ? { appId: cliAppId } : {}),
                  },
                  ...(Object.keys(sources).length > 0 ? { sources } : {}),
                  requiresConfirmation: !cliAppId,
                },
              }) + '\n',
            );
          } catch {
            /* best-effort context */
          }
          process.stdout.write(
            JSON.stringify({
              v: 1,
              '@timestamp': new Date().toISOString(),
              type: 'lifecycle',
              message: `go: planned ${plan.events.length} events for ${plan.frameworkName}`,
              data: {
                event: 'go_plan',
                planId: plan.planId,
                framework: plan.framework,
                frameworkName: plan.frameworkName,
                sdk: plan.sdk,
                eventCount: plan.events.length,
                events: plan.events,
              },
            }) + '\n',
          );
        }

        // Step 2: spawn apply with the plan's id and the caller's
        // pre-resolved decisions. We deliberately reuse the existing
        // `apply` subcommand surface (with all its guards: lockfile,
        // project-marker, install-dir resolution from the plan) so
        // there's only one apply path to maintain.
        const { spawn } = await import('child_process');
        const decision = argv['event-decision'] as
          | 'approved'
          | 'skipped'
          | 'revised';
        const decisionFlag =
          decision === 'approved'
            ? '--approve-events'
            : decision === 'skipped'
            ? '--skip-events'
            : '--revise-events';
        const args = [
          process.argv[1] ?? '',
          'apply',
          '--plan-id',
          plan.planId,
          '--install-dir',
          installDir,
          '--confirm-app',
          decisionFlag,
          '--yes',
        ];
        if (decision === 'revised') {
          args.push(
            typeof argv['revise-feedback'] === 'string'
              ? argv['revise-feedback']
              : '',
          );
        }
        if (mode.jsonOutput) args.push('--json');
        if (mode.allowDestructive) args.push('--force');
        if (typeof argv['app-id'] === 'string') {
          args.push('--app-id', argv['app-id']);
        }

        const child = spawn(process.execPath, args, {
          stdio: 'inherit',
          env: process.env,
        });
        child.on('exit', (code) => process.exit(code ?? ExitCode.AGENT_FAILED));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (mode.jsonOutput) {
          process.stdout.write(
            JSON.stringify({
              v: 1,
              '@timestamp': new Date().toISOString(),
              type: 'error',
              message: `go failed during plan: ${message}`,
              data: { event: 'go_failed', phase: 'plan' },
            }) + '\n',
          );
        } else {
          getUI().log.error(`Go failed during plan: ${message}`);
        }
        process.exit(ExitCode.GENERAL_ERROR);
      }
    })();
  },
};
