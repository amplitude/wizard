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

/**
 * Hard deadline (ms) for the post-dismissal cleanup race. After the user
 * presses a key on the OutroScreen, we try to flush analytics + Sentry,
 * but if the network is dead (the same condition that often produced the
 * error in the first place), `analytics.shutdown()` awaits a promise that
 * never resolves — the Amplitude SDK's `flush()` has no timeout. Without
 * this deadline, `process.exit` never fires and "Press any key to exit"
 * appears broken: the keypress is registered, the dismissal promise
 * resolves, but the process sits silent forever.
 *
 * 3s is generous enough for any realistic flush over a slow connection
 * while keeping the worst-case "stuck" window short enough that a user
 * won't reach for Ctrl+C. Sentry has its own internal 2s flush cap.
 */
const POST_DISMISS_EXIT_DEADLINE_MS = 3000;

/**
 * Race a cleanup promise against a fixed deadline so the wizard is
 * guaranteed to exit even if the cleanup hangs (typically: dead network
 * during analytics flush). Returns when whichever completes first.
 *
 * The timeout uses `unref()` so it doesn't keep the event loop alive on
 * its own — if the cleanup resolves first, the process exits cleanly
 * without waiting for the timer.
 */
async function withExitDeadline(cleanup: Promise<unknown>): Promise<void> {
  await Promise.race([
    cleanup.catch(() => {
      /* surfaced upstream; never block exit */
    }),
    new Promise<void>((resolve) => {
      setTimeout(resolve, POST_DISMISS_EXIT_DEADLINE_MS).unref();
    }),
  ]);
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
  await withExitDeadline(
    Promise.all([
      analytics.shutdown('success'),
      flushSentry().catch(() => {
        /* Sentry flush failure is non-fatal */
      }),
    ]),
  );
  return process.exit(exitCode);
}

// ── Wizard-wide AbortController ──────────────────────────────────────────
//
// Single AbortController shared across the run so any in-flight async work
// (agent SDK query, MCP fetches, ingestion polls, OAuth server, etc.) can
// be cancelled in one shot when the user hits Ctrl+C / SIGINT or when the
// wizard tears down for any other reason.
//
// Why a module-level singleton: the wizard has many entry points (TUI,
// agent mode, CI mode) and many places that need to consume the abort
// signal — a session field would force every consumer to thread the
// session through, and most of these consumers (agent-interface.ts,
// mcp-with-fallback.ts) live below the session in the dependency graph
// and can't import it. Keeping the controller here, alongside the existing
// `wizardAbort()` / `registerCleanup()` API, makes the abort surface
// discoverable in one place.
//
// Lifetime: created lazily on first access and reset by `resetWizardAbortController()`
// (used by tests). In production each `npx @amplitude/wizard` invocation
// is a fresh process, so the lazy-init shape is sufficient — there's no
// per-run reset path because there's no second run.
let _wizardAbortController: AbortController | null = null;

/**
 * Returns the wizard-wide AbortController, creating it on first access.
 * Consumers should pass `getWizardAbortController().signal` into any
 * abortable async API (fetch, agent SDK query, etc.) so a single abort
 * call from the SIGINT / Ctrl+C handler unwinds every in-flight operation.
 */
export function getWizardAbortController(): AbortController {
  if (!_wizardAbortController) {
    _wizardAbortController = new AbortController();
  }
  return _wizardAbortController;
}

/**
 * Convenience: returns the wizard-wide abort signal. Equivalent to
 * `getWizardAbortController().signal` but reads more naturally at call sites
 * that just need the signal (e.g. `fetch(url, { signal: getWizardAbortSignal() })`).
 */
export function getWizardAbortSignal(): AbortSignal {
  return getWizardAbortController().signal;
}

/**
 * Abort the wizard-wide controller. Idempotent — calling on an already-aborted
 * controller is a no-op. Use from graceful-exit / SIGINT handlers to cancel
 * every in-flight async operation in one shot.
 */
export function abortWizard(reason?: string): void {
  const controller = getWizardAbortController();
  if (controller.signal.aborted) return;
  controller.abort(reason ?? 'wizard cancelled');
}

/**
 * Reset the wizard-wide controller. Test-only — production runs are
 * one-shot processes so there's no need to reset between runs.
 */
export function resetWizardAbortController(): void {
  _wizardAbortController = null;
}

/**
 * Tracks whether a `wizardAbort()` is currently in flight (between entry
 * and `process.exit`). The OutroScreen dismissal handler reads this to
 * decide whether to drive the exit itself.
 *
 * Why this exists: screens like DataIngestionCheckScreen, IntroScreen,
 * SetupScreen, and ActivationOptionsScreen navigate to the cancel outro
 * via `store.setOutroData({ kind: OutroKind.Cancel, ... })` — a UI-only
 * navigation that does NOT go through `wizardAbort`. When the user
 * pressed a key on that outro, `signalOutroDismissed` resolved a promise
 * that nobody awaited, no analytics flush ran, no `process.exit` fired,
 * and the wizard hung silently until Ctrl+C. By exporting this flag the
 * outro can detect the "no awaiter" case and route through
 * `wizardSuccessExit` to actually tear down the process.
 *
 * Why not always exit from the outro: when `wizardAbort` IS the caller,
 * it owns the exit code (NETWORK / AGENT_FAILED / etc.) and runs its
 * own analytics flush. A second `process.exit(0)` from the outro would
 * race that path and either lose the real exit code or skip telemetry.
 */
let _wizardAbortInProgress = false;
export function isWizardAbortInProgress(): boolean {
  return _wizardAbortInProgress;
}
/**
 * Test-only — production runs are one-shot processes that exit at the
 * end of `wizardAbort`, so the flag never needs to be reset. Tests that
 * mock `process.exit` (so `wizardAbort` returns instead of terminating)
 * must call this between cases or the flag leaks across the suite.
 */
export function _resetWizardAbortInProgressForTests(): void {
  _wizardAbortInProgress = false;
}

export async function wizardAbort(
  options?: WizardAbortOptions,
): Promise<never> {
  _wizardAbortInProgress = true;
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
  //
  //    Wrapped in `withExitDeadline` because `analytics.shutdown` has no
  //    internal timeout — when the network is dead (often the same
  //    condition that triggered this abort), the Amplitude SDK's flush
  //    awaits forever. Without the deadline, the user presses a key on
  //    the OutroScreen, dismissal fires, but `process.exit` never runs
  //    and the wizard appears to hang silently. The deadline guarantees
  //    we exit within ~3s of dismissal even on a wedged network.
  await withExitDeadline(
    Promise.all([
      analytics.shutdown(error ? 'error' : 'cancelled'),
      flushSentry().catch(() => {
        /* Sentry flush failure is non-fatal */
      }),
    ]),
  );

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
