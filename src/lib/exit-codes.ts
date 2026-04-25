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
  USER_CANCELLED: 130,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
