/**
 * Manual-verification inspection / mark commands (PR 2).
 *
 *   wizard verification list [--json]
 *   wizard verification show <id> [--json]
 *   wizard verification mark <id> --status <passed|failed|skipped>
 *
 * Exit-code surface (extends `docs/exit-codes.md`):
 *
 *   0   success
 *   2   invalid args
 *   33  verification not found
 *   34  verification illegal transition
 *   1   unexpected error
 */
import type { CommandModule } from 'yargs';
import chalk from 'chalk';

import { ExitCode, getUI } from './helpers';
import { ExtendedExitCode } from './orchestration-exit-codes';
import {
  resolveCommonOpts,
  emitJson,
  emitJsonError,
} from './orchestration-common';

// ── wizard verification list ─────────────────────────────────────────

const verificationListCommand: CommandModule = {
  command: 'list',
  describe: 'List manual-verification checkpoints',
  builder: (yargs) =>
    yargs.options({
      'install-dir': {
        describe: 'project directory to inspect',
        type: 'string',
      },
      'session-id': {
        describe: 'restrict to verifications belonging to this session',
        type: 'string',
      },
      status: {
        describe:
          'filter by status (pending, passed, failed, skipped, superseded, all)',
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
        const { VerificationsEnvelopeSchema } = await import(
          '../lib/orchestration/schemas.js'
        );
        const store = getOrchestrationStore(opts.installDir);
        const statusRaw = argv.status as string | undefined;
        const sessionRaw = argv['session-id'] as string | undefined;
        const valid = ['pending', 'passed', 'failed', 'skipped', 'superseded'];
        if (statusRaw && statusRaw !== 'all' && !valid.includes(statusRaw)) {
          const m = `Invalid --status: '${statusRaw}'. Allowed: ${valid.join(
            ', ',
          )}, all.`;
          if (opts.jsonOutput) emitJsonError(m, 'INVALID_ARGS');
          else getUI().log.error(m);
          process.exit(ExitCode.INVALID_ARGS);
        }
        const sessionFilter = sessionRaw as
          | import('../lib/orchestration/state').SessionId
          | undefined;
        // Default: show pending + failed (the actionable ones). Pass
        // `--status all` to see the full history.
        const filter =
          statusRaw === 'all'
            ? undefined
            : statusRaw
            ? [
                statusRaw as import('../lib/orchestration/checkpoints/verifications').VerificationStatus,
              ]
            : ['pending', 'failed'];
        const verifications = store.listVerifications({
          status: filter as
            | import('../lib/orchestration/checkpoints/verifications').VerificationStatus[]
            | undefined,
          sessionId: sessionFilter,
        });

        if (opts.jsonOutput) {
          const envelope = VerificationsEnvelopeSchema.parse({
            v: 1,
            type: 'orchestration_verifications',
            generatedAt: new Date().toISOString(),
            installDir: opts.installDir,
            verifications,
          });
          emitJson(envelope);
        } else {
          const ui = getUI();
          if (verifications.length === 0) {
            ui.log.info(chalk.dim('No matching verifications.'));
          } else {
            ui.log.info(`${verifications.length} verification(s):`);
            for (const v of verifications) {
              ui.log.info(
                `  ${chalk.bold(v.id)}  ${chalk.cyan(v.kind)}  ${chalk.dim(
                  v.status,
                )}  ${v.whatToVerify}`,
              );
            }
          }
        }
        process.exit(ExitCode.SUCCESS);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (opts.jsonOutput) emitJsonError(`verification list failed: ${m}`);
        else getUI().log.error(`Verification list failed: ${m}`);
        process.exit(ExitCode.GENERAL_ERROR);
      }
    })();
  },
};

// ── wizard verification show <id> ────────────────────────────────────

const verificationShowCommand: CommandModule = {
  command: 'show <id>',
  describe: 'Inspect a single manual-verification checkpoint',
  builder: (yargs) =>
    yargs
      .positional('id', {
        type: 'string',
        describe: 'verification id (e.g. verif_<uid>)',
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
        const { VerificationEnvelopeSchema } = await import(
          '../lib/orchestration/schemas.js'
        );
        const { asVerificationId } = await import(
          '../lib/orchestration/checkpoints/verifications.js'
        );
        let id;
        try {
          id = asVerificationId(idRaw);
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          if (opts.jsonOutput) emitJsonError(m, 'INVALID_ARGS');
          else getUI().log.error(m);
          process.exit(ExitCode.INVALID_ARGS);
        }
        const store = getOrchestrationStore(opts.installDir);
        const verification = store.getVerification(id);
        if (!verification) {
          const m = `Verification ${idRaw} not found`;
          if (opts.jsonOutput) emitJsonError(m, 'VERIFICATION_NOT_FOUND');
          else getUI().log.error(m);
          process.exit(ExtendedExitCode.VERIFICATION_NOT_FOUND);
        }
        if (opts.jsonOutput) {
          const envelope = VerificationEnvelopeSchema.parse({
            v: 1,
            type: 'orchestration_verification',
            generatedAt: new Date().toISOString(),
            installDir: opts.installDir,
            verification,
          });
          emitJson(envelope);
        } else {
          const ui = getUI();
          ui.log.info(
            `${chalk.bold(verification.id)}  ${chalk.cyan(verification.kind)}`,
          );
          ui.log.info(`  status:           ${verification.status}`);
          ui.log.info(`  whatToVerify:     ${verification.whatToVerify}`);
          ui.log.info(`  expectedBehavior: ${verification.expectedBehavior}`);
          if (verification.commandToRun.length > 0) {
            ui.log.info(
              `  command:          ${verification.commandToRun.join(' ')}`,
            );
          }
          if (verification.unblockerHint) {
            ui.log.info(`  unblockerHint:    ${verification.unblockerHint}`);
          }
          ui.log.info(`  blockingSession:  ${verification.blockingSessionId}`);
          if (verification.blockingTaskId) {
            ui.log.info(`  blockingTask:     ${verification.blockingTaskId}`);
          }
          if (verification.blockingPRNumber) {
            ui.log.info(
              `  blockingPR:       #${verification.blockingPRNumber}`,
            );
          }
        }
        process.exit(ExitCode.SUCCESS);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (opts.jsonOutput) emitJsonError(`verification show failed: ${m}`);
        else getUI().log.error(`Verification show failed: ${m}`);
        process.exit(ExitCode.GENERAL_ERROR);
      }
    })();
  },
};

// ── wizard verification mark <id> --status <…> ──────────────────────

const verificationMarkCommand: CommandModule = {
  command: 'mark <id>',
  describe: 'Mark a manual-verification checkpoint passed / failed / skipped',
  builder: (yargs) =>
    yargs
      .positional('id', {
        type: 'string',
        describe: 'verification id',
        demandOption: true,
      })
      .options({
        status: {
          describe: 'new status',
          type: 'string',
          choices: ['passed', 'failed', 'skipped'],
          demandOption: true,
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
      const statusArg = argv.status as 'passed' | 'failed' | 'skipped';
      try {
        const { getOrchestrationStore } = await import(
          '../lib/orchestration/store.js'
        );
        const { VerificationMarkEnvelopeSchema } = await import(
          '../lib/orchestration/schemas.js'
        );
        const { asVerificationId, IllegalVerificationTransitionError } =
          await import('../lib/orchestration/checkpoints/verifications.js');
        let id;
        try {
          id = asVerificationId(idRaw);
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          if (opts.jsonOutput) emitJsonError(m, 'INVALID_ARGS');
          else getUI().log.error(m);
          process.exit(ExitCode.INVALID_ARGS);
        }
        const store = getOrchestrationStore(opts.installDir);
        const existing = store.getVerification(id);
        if (!existing) {
          const m = `Verification ${idRaw} not found`;
          if (opts.jsonOutput) emitJsonError(m, 'VERIFICATION_NOT_FOUND');
          else getUI().log.error(m);
          process.exit(ExtendedExitCode.VERIFICATION_NOT_FOUND);
        }
        let updated;
        try {
          updated = store.markVerificationStatus(id, statusArg);
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          if (err instanceof IllegalVerificationTransitionError) {
            if (opts.jsonOutput)
              emitJsonError(m, 'VERIFICATION_INVALID_TRANSITION');
            else getUI().log.error(m);
            process.exit(ExtendedExitCode.VERIFICATION_INVALID_TRANSITION);
          }
          if (opts.jsonOutput) emitJsonError(m, 'GENERAL_ERROR');
          else getUI().log.error(m);
          process.exit(ExitCode.GENERAL_ERROR);
        }
        if (opts.jsonOutput) {
          const envelope = VerificationMarkEnvelopeSchema.parse({
            v: 1,
            type: 'orchestration_verification_mark',
            generatedAt: new Date().toISOString(),
            installDir: opts.installDir,
            verification: updated,
          });
          emitJson(envelope);
        } else {
          getUI().log.info(
            `Marked ${chalk.bold(updated.id)} -> ${chalk.cyan(updated.status)}`,
          );
        }
        process.exit(ExitCode.SUCCESS);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (opts.jsonOutput) emitJsonError(`verification mark failed: ${m}`);
        else getUI().log.error(`Verification mark failed: ${m}`);
        process.exit(ExitCode.GENERAL_ERROR);
      }
    })();
  },
};

export const verificationCommand: CommandModule = {
  command: 'verification <command>',
  describe: 'Inspect and mark manual-verification checkpoints',
  builder: (yargs) =>
    yargs
      .command(verificationListCommand)
      .command(verificationShowCommand)
      .command(verificationMarkCommand)
      .demandCommand(
        1,
        'You must specify a subcommand: list | show <id> | mark <id> --status <…>',
      ),
  handler: () => {
    // Subcommand dispatcher.
  },
};
