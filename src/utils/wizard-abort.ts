/**
 * Single exit point for the wizard. Use instead of process.exit() directly.
 *
 * Sequence: cleanup -> error capture (optional) -> outro (awaits dismissal in
 * TUI) -> analytics shutdown -> process.exit
 *
 * Analytics shutdown intentionally runs AFTER the outro because the error
 * Outro is interactive (press L to open log, C to write bug report) and each
 * of those keypresses fires a `wizardCapture` event we want delivered. If we
 * shut analytics down before cancel, those events queue after the final
 * flush and silently drop on process.exit.
 *
 * WizardError is a data carrier passed to wizardAbort() for analytics context, never thrown.
 * The legacy abort() in setup-utils.ts delegates here.
 */
import { analytics } from './analytics';
import { getUI } from '../ui';
import {
  flushSentry,
  captureError as sentryCaptureError,
} from '../lib/observability';

export class WizardError extends Error {
  constructor(
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'WizardError';
  }
}

interface WizardAbortOptions {
  message?: string;
  error?: Error | WizardError;
  exitCode?: number;
  /**
   * Forwarded to {@link WizardUI.cancel} — surfaces a "Manual setup guide"
   * link in the Outro for cases like an unsupported framework version where
   * we want to point the user at docs to recover.
   */
  cancelOptions?: { docsUrl?: string };
}

const cleanupFns: Array<() => void> = [];

export function registerCleanup(fn: () => void): void {
  cleanupFns.push(fn);
}

/**
 * Register a cleanup that MUST run before any cleanup registered via the
 * regular `registerCleanup`. Use this for restorers that resurrect a
 * pre-run artifact (e.g. the previous setup report) which any later
 * cleanup might clobber by writing a fresh stub at the same canonical
 * path. Priority cleanups run in the order they were registered with
 * each other, but always before the FIFO queue.
 *
 * Ordering invariant: priority cleanups run first so the user's
 * pre-existing on-disk state is restored before any other cleanup
 * (which might write to the same paths) gets a chance to fire.
 */
export function registerPriorityCleanup(fn: () => void): void {
  cleanupFns.unshift(fn);
}

export function clearCleanup(): void {
  cleanupFns.length = 0;
}

/**
 * Graceful end-of-run exit for screens that have ALREADY shown their
 * own terminal UI (OutroScreen, McpScreen standalone, SlackScreen
 * standalone, LogoutScreen) and just need to shut down analytics and
 * exit.
 *
 * Sequence: cleanup -> analytics + Sentry flush -> process.exit.
 * NO `cancel()` UI step — the calling screen's render is already on
 * the terminal and we don't want to clobber it with a second outro.
 *
 * Why this exists: every screen that called `process.exit(0)`
 * directly was firing a `wizardCapture('outro action', …)` (or
 * similar) and then immediately tearing down the process — the
 * analytics event got enqueued AFTER any prior flush and was
 * silently dropped. Routing through this helper guarantees the
 * trailing event makes it out.
 *
 * Use {@link wizardAbort} for FAILURE paths (it shows the error
 * outro). Use this for SUCCESS / user-initiated graceful exits where
 * the screen's own UI is the user-facing message.
 */
export async function wizardSuccessExit(exitCode = 0): Promise<never> {
  for (const fn of cleanupFns) {
    try {
      fn();
    } catch {
      /* cleanup should not prevent exit */
    }
  }
  await Promise.all([
    analytics.shutdown('success'),
    flushSentry().catch(() => {
      /* Sentry flush failure is non-fatal */
    }),
  ]);
  return process.exit(exitCode);
}

export async function wizardAbort(
  options?: WizardAbortOptions,
): Promise<never> {
  const {
    message = 'Wizard setup cancelled.',
    error,
    exitCode = 1,
    cancelOptions,
  } = options ?? {};

  // 1. Run registered cleanup functions
  for (const fn of cleanupFns) {
    try {
      fn();
    } catch {
      /* cleanup should not prevent exit */
    }
  }

  // 2. Capture error in analytics + Sentry (if provided). These are
  //    enqueued / buffered; the actual flush happens in step 4 after
  //    the outro, so any wizardCapture events from outro hotkeys are
  //    flushed in the same batch and not dropped.
  if (error) {
    analytics.captureException(error, {
      ...((error instanceof WizardError && error.context) || {}),
    });
    sentryCaptureError(error, {
      exitCode,
      ...((error instanceof WizardError && error.context) || {}),
    });
  }

  // 3. Display message to user — awaits OutroScreen dismissal in TUI
  //    mode so the user actually gets to see the failure (and use the
  //    "open log" / "write bug report" hotkeys) before the process
  //    dies. AgentUI / LoggingUI resolve immediately since they have
  //    no TUI to render. Any UI that throws here is non-fatal — we
  //    still want to exit with the requested code.
  try {
    await getUI().cancel(message, cancelOptions);
  } catch {
    /* UI failure must not prevent exit */
  }

  // 4. Shutdown analytics and flush Sentry. Runs AFTER cancel so that
  //    wizardCapture events fired during outro interaction (e.g.
  //    'error outro log opened', 'error outro bug report written')
  //    are delivered before the process exits.
  await Promise.all([
    analytics.shutdown(error ? 'error' : 'cancelled'),
    flushSentry().catch(() => {
      /* Sentry flush failure is non-fatal */
    }),
  ]);

  // 5. Exit (fires 'exit' event so TUI cleanup runs)
  //
  // Honor the provided ExitCode in all modes. Previously agent mode forced
  // exit 0 on every abort so that callers like Claude Code wouldn't show red
  // banners — but that made agent-mode output a lie: a failed run indistinct
  // from a successful one is unusable in CI pipelines. Callers who want to
  // suppress error UI should parse the NDJSON stream; the exit code reflects
  // the real outcome.
  return process.exit(exitCode);
}
