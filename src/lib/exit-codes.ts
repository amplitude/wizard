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
  USER_CANCELLED: 130,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
