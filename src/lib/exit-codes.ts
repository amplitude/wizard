/**
 * Numeric exit codes the wizard can return. The values are the public
 * contract — orchestrators (Claude Code, Cursor, Codex, CI pipelines)
 * branch on the number, not the name. Bumping or renumbering a code is
 * a `WIZARD_PROTOCOL_VERSION` bump.
 *
 * Surface: `wizard manifest` and `--print-protocol` both enumerate this
 * map (and `ExitCodeDescription` below) so an orchestrator probing the
 * binary out-of-band gets the same numbers it would observe on a real
 * run. Single source of truth.
 */
export const ExitCode = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  INVALID_ARGS: 2,
  AUTH_REQUIRED: 3,
  NETWORK_ERROR: 4,
  AGENT_FAILED: 10,
  /**
   * `--project-name` conflicted with an existing project (NAME_TAKEN in
   * non-interactive modes, where no retry prompt is possible). Dedicated so
   * orchestrators can script a rename + re-run without confusing it with
   * generic agent failures.
   */
  PROJECT_NAME_TAKEN: 11,
  /**
   * Agent-mode invocation needs a decision from the orchestrator (e.g. which
   * environment / project to use) and `--auto-approve` was not set. The
   * wizard emits a `needs_input` NDJSON event with `choices` + `resumeFlags`,
   * then exits with this code so outer agents can surface the question to a
   * human and re-invoke with the chosen flag.
   */
  INPUT_REQUIRED: 12,
  /**
   * The inner agent attempted to write or run a destructive operation but
   * the current invocation didn't grant `allowWrites` / `allowDestructive`.
   * The PreToolUse write-gate (see `mode-config.ts: evaluateWriteGate`)
   * denies the tool call, the wizard surfaces the deny reason, and exits
   * here so outer agents can re-invoke with `--yes` or `--force`.
   */
  WRITE_REFUSED: 13,
  /**
   * `wizard apply` refused to start because another `wizard apply` is
   * already running against the same install directory — the
   * per-project apply lock (`acquireApplyLock`) detected an in-flight
   * holder. Distinct from INVALID_ARGS so an orchestrator can
   * automatically back off + retry on lock contention without conflating
   * "you passed wrong flags" with "wait your turn". The terminal
   * `run_completed` envelope's `reason: 'lock_held'` discriminator
   * pairs with this code.
   */
  LOCK_HELD: 14,
  /**
   * Internal wizard bug — an uncaught exception, assertion violation, or
   * other unexpected error in the wizard's own code (NOT in the inner
   * Claude agent's behaviour). Distinct from `AGENT_FAILED=10` (the
   * agent run terminated with a real failure, e.g. permission denial,
   * network blip, model overload) and `GENERAL_ERROR=1` (catch-all
   * "something went wrong"). Orchestrators should treat 20 as a wizard
   * defect worth filing a bug report for; 10 is usually
   * environmental/recoverable.
   */
  INTERNAL_ERROR: 20,
  USER_CANCELLED: 130,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * Human-readable description for each `ExitCode`. Surfaced verbatim in
 * `wizard manifest`'s `exitCodes` block and in `--print-protocol`'s
 * payload so an orchestrator that wants to render "wizard exited with
 * code 14 (LOCK_HELD): …" has a short, stable string per code. Keep
 * each description one sentence — orchestrators may render it inline.
 *
 * Single source of truth — adding a new `ExitCode` requires adding the
 * matching description here. A unit test (see
 * `__tests__/agent-manifest.test.ts`) asserts every `ExitCode` enum
 * value has a description, so drift surfaces as a test failure rather
 * than a missing manifest field.
 */
export const ExitCodeDescription: Record<keyof typeof ExitCode, string> = {
  SUCCESS: 'Completed successfully',
  GENERAL_ERROR: 'Unclassified error',
  INVALID_ARGS: 'Invalid flags or arguments',
  AUTH_REQUIRED: 'Not logged in; run `amplitude-wizard login` first',
  NETWORK_ERROR: 'Could not reach Amplitude or a required service',
  AGENT_FAILED: 'The AI-powered setup agent failed mid-run',
  PROJECT_NAME_TAKEN:
    '--project-name conflicted with an existing project (NAME_TAKEN in non-interactive modes)',
  INPUT_REQUIRED:
    'Agent mode needs a decision from the orchestrator; `needs_input` NDJSON event emitted before exit',
  WRITE_REFUSED:
    'A write or destructive operation was denied because the invocation lacked --yes / --force',
  LOCK_HELD:
    'Another `wizard apply` is already running against this install directory',
  INTERNAL_ERROR:
    'Wizard hit an uncaught exception or assertion violation in its own code (not the inner agent)',
  USER_CANCELLED: 'User cancelled (Ctrl-C or prompt rejection)',
};
