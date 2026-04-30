/**
 * Process-level safety net for `uncaughtException` and `unhandledRejection`.
 *
 * Without this, a throw inside an agent hook, MCP callback, or stray async
 * `.then` chain crashes Node with a raw stack trace — no Outro screen, no
 * checkpoint flush, no Sentry capture, and no clean exit code. The user
 * is left staring at terminal vomit and the wizard's hard-won partial
 * progress (region, org/project, framework selection) is wiped.
 *
 * Sequence on a fatal:
 *   1. Capture to Sentry + analytics so we can see the failure remotely.
 *   2. Best-effort `saveCheckpoint` so the user can resume on next run.
 *   3. Route through `wizardAbort` so the user lands on the Outro Error
 *      screen with the same affordances as a normal failure (open log,
 *      write bug report, retry/resume).
 *   4. Force-exit on a hard deadline so a wedged abort path can't leave
 *      the process spinning forever.
 *
 * Re-entry: a second fatal (e.g. abort itself throws) is treated as a
 * defect-in-defect — we skip straight to `process.exit(INTERNAL_ERROR)`
 * to avoid an infinite loop.
 */

import { ExitCode } from '../lib/exit-codes.js';

/**
 * Hard deadline (ms) for the abort path after a fatal. If `wizardAbort`
 * itself hangs (e.g. analytics flush blocks on a dead network), we still
 * want to exit cleanly. 5s is generous enough for a normal Outro
 * dismissal + flush; longer than that and the user is staring at a
 * frozen process.
 */
const FATAL_EXIT_DEADLINE_MS = 5_000;

let _installed = false;
let _handlingFatal = false;

/**
 * Install process-level handlers for uncaught exceptions and unhandled
 * promise rejections. Idempotent — calling more than once is a no-op.
 *
 * Must be called from `bin.ts` after the observability layer is
 * initialized (so Sentry / analytics are wired) and before the TUI
 * mounts (so any throw during UI bootstrap is also caught).
 */
export function installSafetyNet(): void {
  if (_installed) return;
  _installed = true;

  process.on('uncaughtException', (err: unknown) => {
    void handleFatal('uncaughtException', err);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    void handleFatal('unhandledRejection', reason);
  });
}

/**
 * Test-only — reset the install + re-entry flags between assertions.
 */
export function _resetSafetyNetForTests(): void {
  _installed = false;
  _handlingFatal = false;
}

/**
 * Test seam — exposed so tests can drive the fatal path without spawning
 * a child process. Production callers should not invoke this directly.
 */
export async function _handleFatalForTests(
  source: 'uncaughtException' | 'unhandledRejection',
  reason: unknown,
): Promise<void> {
  await handleFatal(source, reason);
}

async function handleFatal(
  source: 'uncaughtException' | 'unhandledRejection',
  reason: unknown,
): Promise<void> {
  // Re-entry guard: if a second fatal fires while we're still handling
  // the first one, we're in a loop. Skip straight to a hard exit so the
  // user doesn't watch the process spiral.
  if (_handlingFatal) {
    try {
      console.error(
        `[wizard] second fatal during abort path (${source}); forcing exit`,
      );
    } catch {
      /* console may itself be wedged */
    }
    process.exit(ExitCode.INTERNAL_ERROR);
    return;
  }
  _handlingFatal = true;

  // Schedule a hard exit deadline. If `wizardAbort` itself hangs (for
  // example, analytics shutdown awaits a wedged network), we still
  // need to exit. Unref so a fast-resolving abort path isn't kept
  // alive by the timer.
  const deadline = setTimeout(() => {
    try {
      console.error('[wizard] abort path exceeded deadline; forcing exit');
    } catch {
      /* best-effort */
    }
    process.exit(ExitCode.INTERNAL_ERROR);
  }, FATAL_EXIT_DEADLINE_MS);
  deadline.unref?.();

  const error = reason instanceof Error ? reason : new Error(String(reason));

  // 1. Sentry + analytics — best-effort, don't let a broken telemetry
  //    pipe block the user-facing recovery path.
  try {
    const { captureError } = await import('../lib/observability/index.js');
    captureError(error, { source, fatal: true });
  } catch {
    /* swallow — telemetry must not gate exit */
  }
  try {
    const { analytics } = await import('./analytics.js');
    analytics.captureException(error, { source, fatal: true });
  } catch {
    /* swallow */
  }

  // 2. Checkpoint save — best-effort. The wizard-store singleton lives
  //    inside the TUI module; we only attempt the save if it's already
  //    been initialized this run. A pre-TUI fatal won't have a session
  //    to checkpoint, and that's fine.
  try {
    await trySaveCheckpointFromActiveSession();
  } catch {
    /* swallow */
  }

  // 3. Route through `wizardAbort` so the user lands on the Outro
  //    Error screen. The Outro picker (Fix 3) gives them Retry / Resume
  //    / Open Log / Bug Report — same affordances as a regular failure.
  try {
    const { wizardAbort } = await import('./wizard-abort.js');
    await wizardAbort({
      error,
      message: friendlyFatalMessage(source, error),
      exitCode: ExitCode.INTERNAL_ERROR,
    });
    // wizardAbort is `Promise<never>` and exits the process. If we
    // get here, something went wrong — fall through to the deadline.
  } catch {
    /* wizardAbort itself failed — let the deadline fire */
  }
}

/**
 * Try to save a checkpoint using the live TUI store, if one has been
 * mounted. Returns silently if no store is available (e.g. fatal during
 * pre-TUI bootstrap, or in agent / CI mode where there's no store).
 */
async function trySaveCheckpointFromActiveSession(): Promise<void> {
  let session: unknown;
  try {
    const { tryGetWizardStoreSession } = await import('./active-session.js');
    session = tryGetWizardStoreSession();
  } catch {
    return;
  }
  if (!session) return;
  try {
    const { saveCheckpoint } = await import('../lib/session-checkpoint.js');
    saveCheckpoint(session as Parameters<typeof saveCheckpoint>[0]);
  } catch {
    /* best-effort */
  }
}

/**
 * Build a concise user-facing message for the Outro Error screen. We
 * deliberately don't paste the full stack here — that's what the log
 * file is for. The fatal path always points users at the log so a
 * developer can actually diagnose what broke.
 */
function friendlyFatalMessage(
  source: 'uncaughtException' | 'unhandledRejection',
  error: Error,
): string {
  const summary = error.message?.split('\n')[0]?.trim() || 'Unknown error';
  const kind =
    source === 'uncaughtException' ? 'unexpected error' : 'unhandled rejection';
  return [
    `The wizard hit an ${kind} and couldn't continue.`,
    '',
    summary,
    '',
    'Press L to open the full log, or C to write a sanitized bug report.',
  ].join('\n');
}
