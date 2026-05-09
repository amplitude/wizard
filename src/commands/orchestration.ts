/**
 * Orchestration inspection commands.
 *
 * Surfaces the durable orchestration store (`src/lib/orchestration/`) to
 * outer agents and humans:
 *
 *   wizard tasks                — list every task in the store
 *   wizard task <id>            — inspect a single task
 *   wizard sessions             — list every session in the store
 *   wizard session <id>         — inspect a single session and its tasks
 *   wizard resume <session-id>  — print (or run with --execute) the resume
 *                                 command for a session
 *   wizard orchestration status — print the LastStoppingPoint snapshot
 *
 * `wizard status` already exists for project setup state — it stays as-is.
 * The new `wizard orchestration status` is the orchestration-specific view.
 *
 * Every command supports `--json` (auto-enabled when stdout is not a TTY)
 * and validates its JSON payload against the Zod schemas in
 * `src/lib/orchestration/schemas.js` before writing — a regression in the
 * producer surfaces as a thrown ZodError on stdout, not a silent corruption
 * downstream.
 */
import type { CommandModule } from 'yargs';
import chalk from 'chalk';

import { ExitCode, getUI } from './helpers';
import { TaskLifecycle } from '../lib/orchestration/lifecycle';
import {
  asSessionId,
  asTaskId,
  type TaskId,
  type SessionId,
} from '../lib/orchestration/state';

// ── Shared option / output helpers ────────────────────────────────────

import {
  resolveCommonOpts,
  emitJson,
  emitJsonError,
} from './orchestration-common';

function formatTimestamp(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return chalk.dim('—');
  try {
    return new Date(ms).toISOString();
  } catch {
    return String(ms);
  }
}

function lifecycleColor(state: TaskLifecycle): string {
  switch (state) {
    case TaskLifecycle.Completed:
      return chalk.green(state);
    case TaskLifecycle.Failed:
      return chalk.red(state);
    case TaskLifecycle.Cancelled:
      return chalk.yellow(state);
    case TaskLifecycle.Running:
      return chalk.cyan(state);
    case TaskLifecycle.WaitingForUser:
      return chalk.magenta(state);
    case TaskLifecycle.Blocked:
      return chalk.red(state);
    case TaskLifecycle.Superseded:
      return chalk.dim(state);
    case TaskLifecycle.Queued:
      return chalk.dim(state);
    default:
      return state;
  }
}

// ── wizard tasks ──────────────────────────────────────────────────────

export const tasksCommand: CommandModule = {
  command: 'tasks',
  describe: 'List orchestration tasks recorded for this project',
  builder: (yargs) =>
    yargs.options({
      'install-dir': {
        describe: 'project directory to inspect',
        type: 'string',
      },
      state: {
        describe:
          'filter by lifecycle state (queued, running, waiting_for_user, blocked, completed, failed, cancelled, superseded)',
        type: 'string',
      },
      'session-id': {
        describe: 'restrict to tasks owned by this session',
        type: 'string',
      },
    }),
  handler: (argv) => {
    void (async () => {
      const opts = await resolveCommonOpts({
        installDir: argv['install-dir'] as string | undefined,
        json: argv.json as boolean | undefined,
        human: argv.human as boolean | undefined,
      });
      try {
        const { getOrchestrationStore } = await import(
          '../lib/orchestration/store.js'
        );
        const store = getOrchestrationStore(opts.installDir);
        const stateFilterRaw = argv.state as string | undefined;
        let stateFilter: TaskLifecycle | undefined;
        if (stateFilterRaw !== undefined) {
          if (
            !Object.values(TaskLifecycle).includes(
              stateFilterRaw as TaskLifecycle,
            )
          ) {
            const message = `Invalid --state value: '${stateFilterRaw}'. Allowed: ${Object.values(
              TaskLifecycle,
            ).join(', ')}.`;
            if (opts.jsonOutput) emitJsonError(message);
            else getUI().log.error(message);
            process.exit(ExitCode.INVALID_ARGS);
          }
          stateFilter = stateFilterRaw as TaskLifecycle;
        }
        let sessionFilter: SessionId | undefined;
        const sessionFilterRaw = argv['session-id'] as string | undefined;
        if (sessionFilterRaw !== undefined) {
          try {
            sessionFilter = asSessionId(sessionFilterRaw);
          } catch (err) {
            const m = err instanceof Error ? err.message : String(err);
            if (opts.jsonOutput) emitJsonError(m);
            else getUI().log.error(m);
            process.exit(ExitCode.INVALID_ARGS);
          }
        }
        if (opts.jsonOutput) {
          // PR 3: shared envelope builder — same code path the
          // `list_tasks` MCP tool calls, so the two surfaces are
          // byte-for-byte identical (modulo `generatedAt`). The builder
          // reads the store internally; no need to pre-compute `tasks` here.
          const { buildTasksEnvelope } = await import(
            '../lib/orchestration/envelopes.js'
          );
          const envelope = buildTasksEnvelope({
            installDir: opts.installDir,
            state: stateFilter,
            sessionId: sessionFilter,
          });
          // Pre-built envelope is already Zod-validated by the builder;
          // skip the redundant `.parse()` we used to do here.
          emitJson(envelope);
        } else {
          const tasks = store.listTasks({
            state: stateFilter,
            sessionId: sessionFilter,
          });
          const ui = getUI();
          if (tasks.length === 0) {
            ui.log.info(chalk.dim('No tasks recorded for this project.'));
          } else {
            ui.log.info(`${tasks.length} task(s):`);
            for (const t of tasks) {
              ui.log.info(
                `  ${chalk.bold(t.id)}  ${lifecycleColor(t.state)}  ${t.label}`,
              );
            }
          }
        }
        process.exit(ExitCode.SUCCESS);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (opts.jsonOutput) emitJsonError(`tasks listing failed: ${message}`);
        else getUI().log.error(`Tasks listing failed: ${message}`);
        process.exit(ExitCode.GENERAL_ERROR);
      }
    })();
  },
};

// ── wizard task <id> ──────────────────────────────────────────────────

export const taskCommand: CommandModule = {
  command: 'task <id>',
  describe: 'Inspect a single orchestration task by id',
  builder: (yargs) =>
    yargs
      .positional('id', {
        type: 'string',
        describe: 'task id (e.g. task_<uid>)',
        demandOption: true,
      })
      .options({
        'install-dir': {
          describe: 'project directory to inspect',
          type: 'string',
        },
      }),
  handler: (argv) => {
    void (async () => {
      const opts = await resolveCommonOpts({
        installDir: argv['install-dir'] as string | undefined,
        json: argv.json as boolean | undefined,
        human: argv.human as boolean | undefined,
      });
      const idRaw = argv.id as string;
      try {
        const { getOrchestrationStore } = await import(
          '../lib/orchestration/store.js'
        );
        const { buildTaskEnvelope } = await import(
          '../lib/orchestration/envelopes.js'
        );
        let id: TaskId;
        try {
          id = asTaskId(idRaw);
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          if (opts.jsonOutput) emitJsonError(m);
          else getUI().log.error(m);
          process.exit(ExitCode.INVALID_ARGS);
        }
        const store = getOrchestrationStore(opts.installDir);
        const task = store.getTask(id!);
        if (!task) {
          if (opts.jsonOutput) emitJsonError(`Task ${idRaw} not found`);
          else getUI().log.error(`Task ${idRaw} not found`);
          process.exit(ExitCode.INVALID_ARGS);
        }
        if (opts.jsonOutput) {
          const envelope = buildTaskEnvelope({
            installDir: opts.installDir,
            taskId: task.id,
          });
          if (envelope) emitJson(envelope);
          else emitJsonError(`Task ${idRaw} not found`);
        } else {
          const ui = getUI();
          ui.log.info(`${chalk.bold(task.id)}  ${task.label}`);
          ui.log.info(`  state:        ${lifecycleColor(task.state)}`);
          ui.log.info(`  session:      ${task.sessionId}`);
          if (task.subagentKind) {
            ui.log.info(`  subagent:     ${task.subagentKind}`);
          }
          if (task.parentTaskId) {
            ui.log.info(`  parent:       ${task.parentTaskId}`);
          }
          ui.log.info(`  created:      ${formatTimestamp(task.createdAt)}`);
          ui.log.info(`  started:      ${formatTimestamp(task.startedAt)}`);
          ui.log.info(`  updated:      ${formatTimestamp(task.updatedAt)}`);
          if (task.waitingFor) {
            ui.log.info(
              `  waiting for:  ${task.waitingFor.kind} (${task.waitingFor.id})`,
            );
            if (task.waitingFor.summary) {
              ui.log.info(`                ${task.waitingFor.summary}`);
            }
          }
          if (task.blockedReason) {
            ui.log.info(`  blocked:      ${task.blockedReason}`);
          }
          if (task.ownership.length > 0) {
            ui.log.info(`  ownership:`);
            for (const o of task.ownership) {
              ui.log.info(`    - ${o.kind}: ${JSON.stringify(o)}`);
            }
          }
          if (task.result) {
            ui.log.info(
              `  result:       ${task.result.outcome}${
                task.result.summary ? ` — ${task.result.summary}` : ''
              }`,
            );
            if (task.result.error) {
              ui.log.info(
                `  error:        [${task.result.error.class}] ${task.result.error.message}`,
              );
            }
          }
        }
        process.exit(ExitCode.SUCCESS);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (opts.jsonOutput) emitJsonError(`task lookup failed: ${message}`);
        else getUI().log.error(`Task lookup failed: ${message}`);
        process.exit(ExitCode.GENERAL_ERROR);
      }
    })();
  },
};

// ── wizard sessions ───────────────────────────────────────────────────

export const sessionsCommand: CommandModule = {
  command: 'sessions',
  describe: 'List wizard sessions recorded for this project',
  builder: (yargs) =>
    yargs.options({
      'install-dir': {
        describe: 'project directory to inspect',
        type: 'string',
      },
    }),
  handler: (argv) => {
    void (async () => {
      const opts = await resolveCommonOpts({
        installDir: argv['install-dir'] as string | undefined,
        json: argv.json as boolean | undefined,
        human: argv.human as boolean | undefined,
      });
      try {
        const { getOrchestrationStore } = await import(
          '../lib/orchestration/store.js'
        );
        const { buildSessionsEnvelope } = await import(
          '../lib/orchestration/envelopes.js'
        );
        const store = getOrchestrationStore(opts.installDir);

        if (opts.jsonOutput) {
          // JSON path delegates to the envelope builder which reads the
          // store internally — skip the local pre-read so the hot path
          // stays a single read. Mirrors the same fix on `status`,
          // `tasks`, `choice list`, `verification list`, `resume`.
          const envelope = buildSessionsEnvelope({
            installDir: opts.installDir,
          });
          emitJson(envelope);
        } else {
          const ui = getUI();
          const sessions = store.listSessions();
          if (sessions.length === 0) {
            ui.log.info(
              chalk.dim('No wizard sessions recorded for this project.'),
            );
          } else {
            ui.log.info(`${sessions.length} session(s):`);
            for (const s of sessions) {
              const status =
                s.status === 'active'
                  ? chalk.cyan(s.status)
                  : s.status === 'succeeded'
                  ? chalk.green(s.status)
                  : s.status === 'failed'
                  ? chalk.red(s.status)
                  : chalk.dim(s.status);
              ui.log.info(
                `  ${chalk.bold(s.id)}  ${status}  ${
                  s.goal ?? chalk.dim('(no goal recorded)')
                }`,
              );
              ui.log.info(
                `    ${chalk.dim('created')} ${formatTimestamp(s.createdAt)}${
                  s.finishedAt
                    ? `  ${chalk.dim('finished')} ${formatTimestamp(
                        s.finishedAt,
                      )}`
                    : ''
                }`,
              );
            }
          }
        }
        process.exit(ExitCode.SUCCESS);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (opts.jsonOutput)
          emitJsonError(`sessions listing failed: ${message}`);
        else getUI().log.error(`Sessions listing failed: ${message}`);
        process.exit(ExitCode.GENERAL_ERROR);
      }
    })();
  },
};

// ── wizard session <id> ──────────────────────────────────────────────

export const sessionCommand: CommandModule = {
  command: 'session <id>',
  describe: 'Inspect a single wizard session and its tasks',
  builder: (yargs) =>
    yargs
      .positional('id', {
        type: 'string',
        describe: 'session id (e.g. session_<uid>)',
        demandOption: true,
      })
      .options({
        'install-dir': {
          describe: 'project directory to inspect',
          type: 'string',
        },
      }),
  handler: (argv) => {
    void (async () => {
      const opts = await resolveCommonOpts({
        installDir: argv['install-dir'] as string | undefined,
        json: argv.json as boolean | undefined,
        human: argv.human as boolean | undefined,
      });
      const idRaw = argv.id as string;
      try {
        const { getOrchestrationStore } = await import(
          '../lib/orchestration/store.js'
        );
        const { buildSessionEnvelope } = await import(
          '../lib/orchestration/envelopes.js'
        );
        let id: SessionId;
        try {
          id = asSessionId(idRaw);
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          if (opts.jsonOutput) emitJsonError(m);
          else getUI().log.error(m);
          process.exit(ExitCode.INVALID_ARGS);
        }
        const store = getOrchestrationStore(opts.installDir);
        const session = store.getSession(id!);
        if (!session) {
          if (opts.jsonOutput) emitJsonError(`Session ${idRaw} not found`);
          else getUI().log.error(`Session ${idRaw} not found`);
          process.exit(ExitCode.INVALID_ARGS);
        }
        if (opts.jsonOutput) {
          const envelope = buildSessionEnvelope({
            installDir: opts.installDir,
            sessionId: session.id,
          });
          if (envelope) emitJson(envelope);
          else emitJsonError(`Session ${idRaw} not found`);
        } else {
          // Human path: read tasks scoped to this session for the
          // bulleted list. The JSON path's `buildSessionEnvelope`
          // already reads tasks internally, so keeping this call inside
          // the `else` branch avoids a duplicate read on the JSON hot
          // path.
          const tasks = store.listTasks({
            sessionId: session.id,
          });
          const ui = getUI();
          ui.log.info(`${chalk.bold(session.id)}`);
          ui.log.info(`  status:    ${session.status}`);
          if (session.goal) ui.log.info(`  goal:      ${session.goal}`);
          if (session.branch) ui.log.info(`  branch:    ${session.branch}`);
          if (session.worktree) ui.log.info(`  worktree:  ${session.worktree}`);
          ui.log.info(`  created:   ${formatTimestamp(session.createdAt)}`);
          if (session.finishedAt) {
            ui.log.info(`  finished:  ${formatTimestamp(session.finishedAt)}`);
          }
          ui.log.info(`  tasks:     ${tasks.length}`);
          for (const t of tasks) {
            ui.log.info(
              `    ${chalk.bold(t.id)}  ${lifecycleColor(t.state)}  ${t.label}`,
            );
          }
        }
        process.exit(ExitCode.SUCCESS);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (opts.jsonOutput) emitJsonError(`session lookup failed: ${message}`);
        else getUI().log.error(`Session lookup failed: ${message}`);
        process.exit(ExitCode.GENERAL_ERROR);
      }
    })();
  },
};

// ── wizard resume <session-id> ───────────────────────────────────────

export const resumeCommand: CommandModule = {
  command: 'resume <session-id>',
  describe:
    'Print (or run with --execute) the resume command for a wizard session',
  builder: (yargs) =>
    yargs
      .positional('session-id', {
        type: 'string',
        describe: 'session id (e.g. session_<uid>)',
        demandOption: true,
      })
      .options({
        'install-dir': {
          describe: 'project directory the session belongs to',
          type: 'string',
        },
        execute: {
          default: false,
          describe:
            'actually invoke the resume command instead of just printing it',
          type: 'boolean',
        },
      }),
  handler: (argv) => {
    void (async () => {
      const opts = await resolveCommonOpts({
        installDir: argv['install-dir'] as string | undefined,
        json: argv.json as boolean | undefined,
        human: argv.human as boolean | undefined,
      });
      const sessionIdRaw = argv['session-id'] as string;
      const execute = Boolean(argv.execute);
      try {
        const { getOrchestrationStore } = await import(
          '../lib/orchestration/store.js'
        );
        const { computeLastStoppingPoint } = await import(
          '../lib/orchestration/last-stopping-point.js'
        );
        const { buildResumeEnvelope } = await import(
          '../lib/orchestration/envelopes.js'
        );
        let sessionId: SessionId;
        try {
          sessionId = asSessionId(sessionIdRaw);
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          if (opts.jsonOutput) emitJsonError(m);
          else getUI().log.error(m);
          process.exit(ExitCode.INVALID_ARGS);
        }
        const store = getOrchestrationStore(opts.installDir);
        const session = store.getSession(sessionId!);
        if (!session) {
          if (opts.jsonOutput)
            emitJsonError(`Session ${sessionIdRaw} not found`);
          else getUI().log.error(`Session ${sessionIdRaw} not found`);
          process.exit(ExitCode.INVALID_ARGS);
        }
        // The resume `command` array is needed both for the human path
        // (printed via `Resume: …`) and for the `--execute` spawn below.
        // Compute it lazily so the JSON-only hot path doesn't pay for an
        // extra `computeLastStoppingPoint` (and another store read) that
        // `buildResumeEnvelope` already does internally — mirrors the
        // "skip pre-read on JSON path" pattern applied to `status` /
        // `tasks` / `choice list` / `verification list`.
        let resumeCommand: string[] | undefined;
        const ensureResumeCommand = (): string[] => {
          if (resumeCommand) return resumeCommand;
          const lsp = computeLastStoppingPoint(opts.installDir, {
            sessionId: session.id,
          });
          resumeCommand = lsp.nextAction.command;
          return resumeCommand;
        };

        if (opts.jsonOutput) {
          const envelope = buildResumeEnvelope({
            installDir: opts.installDir,
            sessionId: session.id,
            executed: execute,
          });
          emitJson(envelope);
        } else {
          // Human path: scope LSP to the resolved session so the resume
          // command and description belong to the session the user asked
          // for, not the most-recently-active session in the store.
          const lsp = computeLastStoppingPoint(opts.installDir, {
            sessionId: session.id,
          });
          resumeCommand = lsp.nextAction.command;
          const ui = getUI();
          ui.log.info(lsp.nextAction.description);
          // Use the shell-quoted `resumeCommand` so the printed string is
          // copy-pasteable when `installDir` (or any other argv) contains
          // whitespace or shell metacharacters.
          ui.log.info(`Resume: ${chalk.bold(lsp.resumeCommand)}`);
          if (!execute) {
            ui.log.info(
              chalk.dim('(pass --execute to invoke this command directly)'),
            );
          }
        }

        if (execute) {
          // Spawn the resume command. Default behavior is "print only" for
          // safety — orchestrators that want auto-execution opt in.
          // Use cross-platform-spawn so the npm-installed `amplitude-wizard`
          // .cmd shim resolves on Windows (Node's built-in spawn does not
          // consult PATHEXT).
          const { spawn } = await import('../utils/cross-platform-spawn.js');
          const [cmd, ...rest] = ensureResumeCommand();
          if (!cmd) {
            if (opts.jsonOutput)
              emitJsonError('Resume command is empty — nothing to execute.');
            else
              getUI().log.error(
                'Resume command is empty — nothing to execute.',
              );
            process.exit(ExitCode.GENERAL_ERROR);
          }
          const child = spawn(cmd, rest, { stdio: 'inherit' });
          // Attach an `error` listener BEFORE `exit`. If the spawn fails
          // synchronously (binary not on PATH, ENOENT, EACCES) Node fires
          // an `error` event; without a listener the EventEmitter rethrows
          // and crashes the process with a stack trace instead of a clean
          // CLI failure.
          child.on('error', (err) => {
            const message = err instanceof Error ? err.message : String(err);
            if (opts.jsonOutput)
              emitJsonError(`Failed to spawn resume command: ${message}`);
            else
              getUI().log.error(`Failed to spawn resume command: ${message}`);
            process.exit(ExitCode.GENERAL_ERROR);
          });
          child.on('exit', (code) => {
            process.exit(code ?? 0);
          });
          return; // exit is handled by child handler
        }
        process.exit(ExitCode.SUCCESS);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (opts.jsonOutput) emitJsonError(`resume failed: ${message}`);
        else getUI().log.error(`Resume failed: ${message}`);
        process.exit(ExitCode.GENERAL_ERROR);
      }
    })();
  },
};

// ── wizard orchestration status ──────────────────────────────────────

export const orchestrationCommand: CommandModule = {
  command: 'orchestration <command>',
  describe: 'Inspect the durable orchestration store',
  builder: (yargs) =>
    yargs
      .command(
        'status',
        'Print the last-stopping-point snapshot for this project',
        (yargs) =>
          yargs.options({
            'install-dir': {
              describe: 'project directory to inspect',
              type: 'string',
            },
          }),
        (argv) => {
          void (async () => {
            const opts = await resolveCommonOpts({
              installDir: argv['install-dir'],
              json: argv.json as boolean | undefined,
              human: argv.human as boolean | undefined,
            });
            try {
              const { getOrchestrationStore } = await import(
                '../lib/orchestration/store.js'
              );
              const { buildStatusEnvelope } = await import(
                '../lib/orchestration/envelopes.js'
              );
              const store = getOrchestrationStore(opts.installDir);

              if (opts.jsonOutput) {
                // JSON hot path: `buildStatusEnvelope` calls
                // `computeLastStoppingPoint` internally — no need to
                // pre-compute it here.
                const envelope = buildStatusEnvelope({
                  installDir: opts.installDir,
                });
                emitJson(envelope);
              } else {
                // Human-readable path: compute the snapshot once, render it.
                const { computeLastStoppingPoint } = await import(
                  '../lib/orchestration/last-stopping-point.js'
                );
                const lsp = computeLastStoppingPoint(opts.installDir);
                const ui = getUI();
                if (!store.exists()) {
                  ui.log.info(
                    chalk.dim(
                      `No orchestration store recorded yet (${store.path}).`,
                    ),
                  );
                  ui.log.info(lsp.nextAction.description);
                  ui.log.info(`Resume: ${chalk.bold(lsp.resumeCommand)}`);
                } else {
                  ui.log.info(
                    `Store: ${chalk.dim(store.path)}  ${chalk.dim(
                      `(generated ${formatTimestamp(lsp.generatedAt)})`,
                    )}`,
                  );
                  if (lsp.currentSessionId) {
                    ui.log.info(`Active session: ${lsp.currentSessionId}`);
                  }
                  if (lsp.currentGoal) {
                    ui.log.info(`Goal:           ${lsp.currentGoal}`);
                  }
                  if (lsp.currentBranch) {
                    ui.log.info(`Branch:         ${lsp.currentBranch}`);
                  }
                  if (lsp.currentWorktree) {
                    ui.log.info(`Worktree:       ${lsp.currentWorktree}`);
                  }
                  ui.log.info(
                    `Active tasks:           ${lsp.activeTasks.length}`,
                  );
                  ui.log.info(
                    `Stopped tasks (24h):    ${lsp.stoppedTasks.length}`,
                  );
                  ui.log.info(
                    `Recently completed:     ${lsp.recentlyCompletedTasks.length}`,
                  );
                  ui.log.info('');
                  ui.log.info(`Next action: ${lsp.nextAction.description}`);
                  ui.log.info(`Resume:      ${chalk.bold(lsp.resumeCommand)}`);
                }
              }
              process.exit(ExitCode.SUCCESS);
            } catch (e) {
              const message = e instanceof Error ? e.message : String(e);
              if (opts.jsonOutput)
                emitJsonError(`orchestration status failed: ${message}`);
              else getUI().log.error(`Orchestration status failed: ${message}`);
              process.exit(ExitCode.GENERAL_ERROR);
            }
          })();
        },
      )
      .demandCommand(
        1,
        'You must specify a subcommand: `orchestration status`',
      ),
  handler: () => {
    // Subcommand dispatcher — demandCommand handles the no-op case.
  },
};
