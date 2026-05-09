/**
 * Orchestration choice inspection / answer commands (PR 2).
 *
 *   wizard choice list [--json]                   — pending choices
 *   wizard choice show <id> [--json]              — detail
 *   wizard choice answer <id> --option <option-id>
 *
 * `wizard choice answer` enforces the **automation gate**: a choice with
 * `requiresHuman === true` cannot be answered unless the operator passes
 * `--confirm-human`. Without that flag the command exits with
 * `CHOICE_REQUIRES_HUMAN=5` and an actionable error message. This is the
 * brief's "automation may not choose on the user's behalf" requirement.
 *
 * Exit-code surface (extends `docs/exit-codes.md`):
 *
 *   0  success
 *   2  invalid args (bad id prefix, missing positional)
 *   3  choice not found
 *   4  choice already answered / terminal
 *   5  choice.requiresHuman === true and --confirm-human absent
 *   1  unexpected error
 */
import type { CommandModule } from 'yargs';
import chalk from 'chalk';

import { ExitCode, getUI } from './helpers';
import { ExtendedExitCode } from './orchestration-exit-codes';

interface CommonOpts {
  installDir: string;
  jsonOutput: boolean;
}

async function resolveCommonOpts(argv: {
  installDir?: string;
  json?: boolean;
  human?: boolean;
}): Promise<CommonOpts> {
  const installDir = argv.installDir ?? process.cwd();
  const { resolveMode } = await import('../lib/mode-config.js');
  const { jsonOutput } = resolveMode({
    json: argv.json,
    human: argv.human,
    isTTY: Boolean(process.stdout.isTTY),
  });
  return { installDir, jsonOutput };
}

function emitJson(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload) + '\n');
}

function emitJsonError(message: string, code?: string): void {
  emitJson({
    v: 1,
    type: 'error',
    '@timestamp': new Date().toISOString(),
    code,
    message,
  });
}

// ── wizard choice list ────────────────────────────────────────────────

const choiceListCommand: CommandModule = {
  command: 'list',
  describe: 'List pending user-choice checkpoints',
  builder: (yargs) =>
    yargs.options({
      'install-dir': {
        describe: 'project directory to inspect',
        type: 'string',
      },
      'session-id': {
        describe: 'restrict to choices belonging to this session',
        type: 'string',
      },
      status: {
        describe:
          'filter by status (pending, answered, expired, cancelled, superseded)',
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
        const { ChoicesEnvelopeSchema } = await import(
          '../lib/orchestration/schemas.js'
        );
        const store = getOrchestrationStore(opts.installDir);
        const statusRaw = argv.status as string | undefined;
        const sessionRaw = argv['session-id'] as string | undefined;
        let status:
          | import('../lib/orchestration/checkpoints/choices').ChoiceStatus
          | undefined;
        if (statusRaw) {
          const valid = [
            'pending',
            'answered',
            'expired',
            'cancelled',
            'superseded',
          ];
          if (!valid.includes(statusRaw)) {
            const m = `Invalid --status value: '${statusRaw}'. Allowed: ${valid.join(
              ', ',
            )}.`;
            if (opts.jsonOutput) emitJsonError(m, 'INVALID_ARGS');
            else getUI().log.error(m);
            process.exit(ExitCode.INVALID_ARGS);
          }
          status =
            statusRaw as import('../lib/orchestration/checkpoints/choices').ChoiceStatus;
        }
        const sessionFilter = sessionRaw as
          | import('../lib/orchestration/state').SessionId
          | undefined;
        // Default: list pending choices when no filter is given. That's
        // the common operator question ("what does the wizard need from
        // the user right now?"). Operators wanting the full history can
        // pass `--status answered` or omit the default by passing
        // `--status all` (treated below).
        const effectiveStatus =
          statusRaw === 'all' ? undefined : status ?? 'pending';
        const choices = store.listChoices({
          status: effectiveStatus,
          sessionId: sessionFilter,
        });

        if (opts.jsonOutput) {
          const envelope = ChoicesEnvelopeSchema.parse({
            v: 1,
            type: 'orchestration_choices',
            generatedAt: new Date().toISOString(),
            installDir: opts.installDir,
            choices,
          });
          emitJson(envelope);
        } else {
          const ui = getUI();
          if (choices.length === 0) {
            ui.log.info(chalk.dim('No matching choices.'));
          } else {
            ui.log.info(`${choices.length} choice(s):`);
            for (const c of choices) {
              ui.log.info(
                `  ${chalk.bold(c.id)}  ${chalk.cyan(c.kind)}  ${chalk.dim(
                  c.status,
                )}  ${c.message}`,
              );
              if (c.requiresHuman) {
                ui.log.info(`    ${chalk.yellow('requires_human=true')}`);
              }
            }
          }
        }
        process.exit(ExitCode.SUCCESS);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (opts.jsonOutput) emitJsonError(`choice list failed: ${m}`);
        else getUI().log.error(`Choice list failed: ${m}`);
        process.exit(ExitCode.GENERAL_ERROR);
      }
    })();
  },
};

// ── wizard choice show <id> ──────────────────────────────────────────

const choiceShowCommand: CommandModule = {
  command: 'show <id>',
  describe: 'Inspect a single user-choice checkpoint',
  builder: (yargs) =>
    yargs
      .positional('id', {
        type: 'string',
        describe: 'choice id (e.g. choice_<uid>)',
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
        const { ChoiceEnvelopeSchema } = await import(
          '../lib/orchestration/schemas.js'
        );
        const { asChoiceId } = await import(
          '../lib/orchestration/checkpoints/choices.js'
        );
        let id;
        try {
          id = asChoiceId(idRaw);
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          if (opts.jsonOutput) emitJsonError(m, 'INVALID_ARGS');
          else getUI().log.error(m);
          process.exit(ExitCode.INVALID_ARGS);
        }
        const store = getOrchestrationStore(opts.installDir);
        const choice = store.getChoice(id);
        if (!choice) {
          const m = `Choice ${idRaw} not found`;
          if (opts.jsonOutput) emitJsonError(m, 'CHOICE_NOT_FOUND');
          else getUI().log.error(m);
          process.exit(ExtendedExitCode.CHOICE_NOT_FOUND);
        }
        if (opts.jsonOutput) {
          const envelope = ChoiceEnvelopeSchema.parse({
            v: 1,
            type: 'orchestration_choice',
            generatedAt: new Date().toISOString(),
            installDir: opts.installDir,
            choice,
          });
          emitJson(envelope);
        } else {
          const ui = getUI();
          ui.log.info(`${chalk.bold(choice.id)}  ${chalk.cyan(choice.kind)}`);
          ui.log.info(`  status:           ${choice.status}`);
          ui.log.info(`  promptId:         ${choice.promptId}`);
          ui.log.info(`  message:          ${choice.message}`);
          ui.log.info(`  requiresHuman:    ${choice.requiresHuman}`);
          ui.log.info(`  automationAllowed: ${choice.automationAllowed}`);
          ui.log.info(`  reversible:       ${choice.reversible}`);
          ui.log.info(`  whyAsking:        ${choice.whyAsking}`);
          ui.log.info(`  consequenceIfSkipped: ${choice.consequenceIfSkipped}`);
          ui.log.info(`  options:`);
          for (const o of choice.options) {
            const tags = [
              o.id === choice.recommendedOptionId ? 'recommended' : null,
              o.id === choice.safeDefaultOptionId ? 'safe-default' : null,
            ]
              .filter(Boolean)
              .join(', ');
            ui.log.info(
              `    - ${chalk.bold(o.id)}: ${o.label}${
                tags ? ` (${tags})` : ''
              }`,
            );
            if (o.description) ui.log.info(`        ${o.description}`);
          }
          if (choice.answeredOptionId) {
            ui.log.info(
              `  answered:         ${choice.answeredOptionId} (by ${
                choice.answeredBy ?? 'unknown'
              })`,
            );
          }
        }
        process.exit(ExitCode.SUCCESS);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (opts.jsonOutput) emitJsonError(`choice show failed: ${m}`);
        else getUI().log.error(`Choice show failed: ${m}`);
        process.exit(ExitCode.GENERAL_ERROR);
      }
    })();
  },
};

// ── wizard choice answer <id> --option <option-id> ───────────────────

const choiceAnswerCommand: CommandModule = {
  command: 'answer <id>',
  describe: 'Answer a pending user-choice checkpoint',
  builder: (yargs) =>
    yargs
      .positional('id', {
        type: 'string',
        describe: 'choice id (e.g. choice_<uid>)',
        demandOption: true,
      })
      .options({
        option: {
          describe: 'option id from choice.options[].id',
          type: 'string',
          demandOption: true,
        },
        'confirm-human': {
          describe:
            'Required when choice.requiresHuman === true. Operator asserts a human ' +
            'is present and authorising the answer.',
          type: 'boolean',
          default: false,
        },
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
      const optionId = argv.option as string;
      const confirmHuman = Boolean(argv['confirm-human']);
      try {
        const { getOrchestrationStore } = await import(
          '../lib/orchestration/store.js'
        );
        const { ChoiceAnswerEnvelopeSchema } = await import(
          '../lib/orchestration/schemas.js'
        );
        const { asChoiceId, ChoiceStatus } = await import(
          '../lib/orchestration/checkpoints/choices.js'
        );
        let id;
        try {
          id = asChoiceId(idRaw);
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          if (opts.jsonOutput) emitJsonError(m, 'INVALID_ARGS');
          else getUI().log.error(m);
          process.exit(ExitCode.INVALID_ARGS);
        }
        const store = getOrchestrationStore(opts.installDir);
        const existing = store.getChoice(id);
        if (!existing) {
          const m = `Choice ${idRaw} not found`;
          if (opts.jsonOutput) emitJsonError(m, 'CHOICE_NOT_FOUND');
          else getUI().log.error(m);
          process.exit(ExtendedExitCode.CHOICE_NOT_FOUND);
        }
        if (existing.status !== ChoiceStatus.Pending) {
          const m = `Choice ${idRaw} is in status '${existing.status}', not 'pending'.`;
          if (opts.jsonOutput) emitJsonError(m, 'CHOICE_NOT_PENDING');
          else getUI().log.error(m);
          process.exit(ExtendedExitCode.CHOICE_NOT_PENDING);
        }
        // Automation gate: refuse to answer when the choice requires a
        // human and the operator hasn't asserted one is present.
        if (existing.requiresHuman && !confirmHuman) {
          const m =
            `Choice ${idRaw} requires a human to answer. ` +
            `Re-run with --confirm-human if a human is present and authorising the answer.`;
          if (opts.jsonOutput) emitJsonError(m, 'CHOICE_REQUIRES_HUMAN');
          else getUI().log.error(m);
          process.exit(ExtendedExitCode.CHOICE_REQUIRES_HUMAN);
        }
        let updated;
        try {
          updated = store.answerChoice(
            id,
            optionId,
            // When --confirm-human is passed and requiresHuman is true,
            // we record the answer as 'human' (operator-attested);
            // automation-allowed choices answered without --confirm-human
            // record as 'automation'.
            existing.requiresHuman || confirmHuman ? 'human' : 'automation',
          );
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          if (opts.jsonOutput) emitJsonError(m, 'INVALID_OPTION');
          else getUI().log.error(m);
          process.exit(ExitCode.INVALID_ARGS);
        }
        if (opts.jsonOutput) {
          const envelope = ChoiceAnswerEnvelopeSchema.parse({
            v: 1,
            type: 'orchestration_choice_answer',
            generatedAt: new Date().toISOString(),
            installDir: opts.installDir,
            choice: updated,
          });
          emitJson(envelope);
        } else {
          getUI().log.info(
            `Answered ${chalk.bold(updated.id)} -> ${chalk.cyan(
              updated.answeredOptionId ?? '?',
            )} (by ${updated.answeredBy})`,
          );
        }
        process.exit(ExitCode.SUCCESS);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (opts.jsonOutput) emitJsonError(`choice answer failed: ${m}`);
        else getUI().log.error(`Choice answer failed: ${m}`);
        process.exit(ExitCode.GENERAL_ERROR);
      }
    })();
  },
};

export const choiceCommand: CommandModule = {
  command: 'choice <command>',
  describe: 'Inspect and answer user-choice checkpoints',
  builder: (yargs) =>
    yargs
      .command(choiceListCommand)
      .command(choiceShowCommand)
      .command(choiceAnswerCommand)
      .demandCommand(
        1,
        'You must specify a subcommand: list | show <id> | answer <id> --option <option-id>',
      ),
  handler: () => {
    // Subcommand dispatcher.
  },
};
