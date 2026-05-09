/**
 * Extended exit codes for the PR 2 inspection commands.
 *
 * These cohabit the existing exit-code namespace owned by
 * `src/lib/exit-codes.ts`. The values 3 and 4 are already taken in the
 * top-level enum (`AUTH_REQUIRED`, `NETWORK_ERROR`) — we map the new
 * "choice not found" / "choice not pending" / "requires human"
 * outcomes to fresh integers in the 30s range so an orchestrator's
 * `case` table never collides with the legacy 1/2/3/4/10/etc surface.
 *
 * Why a separate file: the legacy `ExitCode` enum is part of the
 * wizard's stable public contract (orchestrators script against it).
 * Adding `CHOICE_*` to `ExitCode` would broaden that contract for codes
 * only the new sub-commands ever return; keeping them isolated lets us
 * iterate on the PR 2 surface without churning the global enum.
 */
export const ExtendedExitCode = {
  /** A `wizard choice <command>` could not find the requested id. */
  CHOICE_NOT_FOUND: 30,
  /**
   * A `wizard choice answer` targeted a choice not in `pending` status
   * (already answered, expired, cancelled, or superseded).
   */
  CHOICE_NOT_PENDING: 31,
  /**
   * The targeted choice has `requiresHuman === true` and the operator
   * did not pass `--confirm-human`. Automation MUST NOT proceed.
   */
  CHOICE_REQUIRES_HUMAN: 32,
  /** A `wizard verification <command>` could not find the requested id. */
  VERIFICATION_NOT_FOUND: 33,
  /**
   * A `wizard verification mark` targeted a verification whose current
   * status disallows the requested transition (e.g. `passed -> failed`).
   */
  VERIFICATION_INVALID_TRANSITION: 34,
} as const;
export type ExtendedExitCode =
  (typeof ExtendedExitCode)[keyof typeof ExtendedExitCode];
