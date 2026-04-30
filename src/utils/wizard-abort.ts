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
import { ExitCode } from '../lib/exit-codes';
import { suppressPipeAbort } from './pipe-errors';

/**
 * Map an exit code to the analytics shutdown status. We tell Amplitude
 * what *kind* of run this was so the `'session ended'` event matches
 * what actually happened — earlier code hardcoded `'success'` here,
 * which silently mislabelled every Cancel (130) and Error (10) exit
 * as success in the analytics dimension.
 */
function analyticsStatusFromExitCode(
  exitCode: number,
): 'success' | 'cancelled' | 'error' {
  if (exitCode === ExitCode.SUCCESS) return 'success';
  if (exitCode === ExitCode.USER_CANCELLED) return 'cancelled';
  return 'error';
}

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
 * Sequence: cleanup -> emit run_completed -> analytics + Sentry flush
 * -> process.exit. NO `cancel()` UI step — the calling screen's
 * render is already on the terminal and we don't want to clobber it
 * with a second outro.
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
  // Suppress any future EPIPE-driven abort. We're already on the way
  // out — if `emitRunCompleted` below (or any later write) hits a
  // closed pipe, the default path would schedule a deferred
  // `wizardAbort` that races our `process.exit(0)` and clobbers the
  // exit code with 130 (USER_CANCELLED). Bugbot caught this race;
  // marking the flag here neutralizes the deferred trigger.
  suppressPipeAbort();
  for (const fn of cleanupFns) {
    try {
      fn();
    } catch {
      /* cleanup should not prevent exit */
    }
  }
  // Emit the terminal `setup_complete` NDJSON event BEFORE
  // `run_completed` so an orchestrator subscribing to
  // outcome-class events sees the artifact list (appId, dashboard
  // URL, files, env vars) on the same stream as the success
  // signal. Best-effort: if no payload was registered (e.g. a
  // login-only command), we skip emission.
  try {
    const { consumeSetupComplete, dashboardIdFromUrl } = await import(
      '../lib/setup-complete-registry.js'
    );
    const setupComplete = consumeSetupComplete();
    if (setupComplete) {
      // Auto-derive `dashboardId` from `dashboardUrl` when the
      // caller didn't fill it in explicitly. Cheap convenience —
      // every Amplitude dashboard URL embeds the id as its last
      // path segment, so the orchestrator shouldn't have to parse
      // it out for follow-up MCP queries.
      if (
        setupComplete.amplitude.dashboardUrl &&
        !setupComplete.amplitude.dashboardId
      ) {
        const id = dashboardIdFromUrl(setupComplete.amplitude.dashboardUrl);
        if (id) setupComplete.amplitude.dashboardId = id;
      }
      // Stamp wall-clock duration from the same source as
      // `run_completed` so downstream tooling can correlate the two.
      if (setupComplete.durationMs === undefined) {
        setupComplete.durationMs = computeRunDurationMs();
      }
      getUI().emitSetupComplete?.(setupComplete);

      // Persist the canonical scope into ampli.json so a future
      // agent session in the same codebase can recover the
      // appId / dashboardUrl without re-running setup. Best-effort:
      // a failed write here must never prevent exit.
      try {
        const { readAmpliConfig, writeAmpliConfig, mergeAmpliConfig } =
          await import('../lib/ampli-config.js');
        // Resolve the install dir from process.env if the spawn
        // injected one (`apply` does this); otherwise default to
        // cwd. The wizard's own runtime always lives in the
        // install dir, so cwd is correct for non-spawned runs.
        // Funnel through `resolveInstallDir` so a `~`-relative env
        // var (e.g. set by an outer shell that didn't expand it) is
        // expanded before any downstream consumer touches it.
        const { resolveInstallDir } = await import('./install-dir.js');
        const installDir = resolveInstallDir(
          process.env.AMPLITUDE_WIZARD_INSTALL_DIR,
        );
        const existing = readAmpliConfig(installDir);
        const base = existing.ok ? existing.config : {};
        const a = setupComplete.amplitude;
        const next = mergeAmpliConfig(base, {
          ...(a.orgId ? { OrgId: a.orgId } : {}),
          ...(a.projectId ? { ProjectId: a.projectId } : {}),
          ...(a.region ? { Zone: a.region } : {}),
          ...(a.appId ? { AppId: a.appId } : {}),
          ...(a.appName ? { AppName: a.appName } : {}),
          ...(a.envName ? { EnvName: a.envName } : {}),
          ...(a.dashboardUrl ? { DashboardUrl: a.dashboardUrl } : {}),
          ...(a.dashboardId ? { DashboardId: a.dashboardId } : {}),
        });
        writeAmpliConfig(installDir, next);
      } catch {
        /* ampli.json persistence is best-effort */
      }
    }
  } catch {
    /* setup-complete emission must never block exit */
  }
  // Emit the terminal `run_completed` NDJSON event BEFORE shutting
  // analytics down. AgentUI is the only UI that implements this; for
  // InkUI / LoggingUI it's a no-op. The event has to land on stdout
  // before `process.exit` fires — orchestrators rely on its presence
  // (vs absence) to distinguish a clean run from a crash. Wrapped in
  // try/catch so a misbehaving emitter can't block the exit.
  try {
    getUI().emitRunCompleted?.({
      outcome: 'success',
      exitCode,
      durationMs: computeRunDurationMs(),
    });
  } catch {
    /* terminal event emitter must not prevent exit */
  }
  // Wrap shutdown in `withExitDeadline` (added on main since this
  // branch was forked) so a wedged network on `analytics.shutdown`
  // can't keep the process alive forever after the user dismissed
  // the outro. The 3s deadline guarantees we exit predictably even
  // when the same condition that caused the abort also wedged the
  // analytics flush.
  await withExitDeadline(
    Promise.all([
      analytics.shutdown(analyticsStatusFromExitCode(exitCode)),
      flushSentry().catch(() => {
        /* Sentry flush failure is non-fatal */
      }),
    ]),
  );
  return process.exit(exitCode);
}

/**
 * Compute the wall-clock duration of the current run. Reads from
 * AgentUI's `getRunStartedAtMs()` when available. For non-agent UIs
 * (TUI, CI logger), the run-start timestamp isn't tracked and we
 * report `0` — the value is only meaningful for orchestrator-facing
 * NDJSON, which only fires from AgentUI anyway.
 */
function computeRunDurationMs(): number {
  try {
    const ui = getUI() as { getRunStartedAtMs?: () => number | null };
    const startedAt = ui.getRunStartedAtMs?.() ?? null;
    if (startedAt === null) return 0;
    return Math.max(0, Date.now() - startedAt);
  } catch {
    return 0;
  }
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

  // Suppress any future EPIPE-driven abort. We're already aborting —
  // a deferred pipe-trigger firing mid-shutdown would clobber the
  // caller's intended exit code with 130. Same fix as
  // `wizardSuccessExit`. Bugbot finding (Medium).
  suppressPipeAbort();

  // Discard any partial setup_complete payload — a failed run must
  // never emit a terminal artifact event; the orchestrator's signal
  // for "setup landed" is presence of `setup_complete` followed by
  // `run_completed: success`. Leaving stale data behind would leak
  // into the next run inside the same process (test harnesses).
  try {
    const { resetSetupComplete } = await import(
      '../lib/setup-complete-registry.js'
    );
    resetSetupComplete();
  } catch {
    /* registry reset must never block abort */
  }

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

  // 4. Emit the terminal `run_completed` NDJSON event before shutting
  //    analytics down. AgentUI is the only UI that implements this;
  //    for InkUI / LoggingUI it's a no-op. The outcome distinguishes
  //    `error` (an unexpected failure with `error` populated) from
  //    `cancelled` (graceful exit without an error — e.g. user hit
  //    Esc on the framework picker). Wrapped in try/catch so a
  //    misbehaving emitter can't block the exit.
  const outcome: 'error' | 'cancelled' = error ? 'error' : 'cancelled';
  try {
    getUI().emitRunCompleted?.({
      outcome,
      exitCode,
      durationMs: computeRunDurationMs(),
      // Sanitize the message before exposing it on stdout — the
      // sanitizer used by AgentUI.setRunError already redacts paths
      // and URLs. We use the raw message here because abortMessage
      // is operator-friendly and rarely contains secrets, but the
      // RunCompletedData docstring promises sanitization. AgentUI's
      // emit() doesn't currently re-sanitize, so do it here to keep
      // the contract honest.
      ...(message ? { reason: sanitizeReason(message) } : {}),
    });
  } catch {
    /* terminal event emitter must not prevent exit */
  }

  // 5. Shutdown analytics and flush Sentry. Runs AFTER cancel so that
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

  // 6. Exit (fires 'exit' event so TUI cleanup runs)
  //
  // Honor the provided ExitCode in all modes. Previously agent mode forced
  // exit 0 on every abort so that callers like Claude Code wouldn't show red
  // banners — but that made agent-mode output a lie: a failed run indistinct
  // from a successful one is unusable in CI pipelines. Callers who want to
  // suppress error UI should parse the NDJSON stream; the exit code reflects
  // the real outcome.
  return process.exit(exitCode);
}

/**
 * Strip path / URL fragments from a free-form reason string before
 * shipping it on stdout. Mirrors the conservative redaction in
 * `AgentUI.setRunError`'s fallback path so the `run_completed` event
 * never leaks `/Users/<name>/...` or query-string secrets.
 *
 * Best-effort: we don't pull in the full observability redactor here
 * because this module loads early in bin.ts startup and we want to
 * avoid the import cost on every `wizardAbort` call.
 */
function sanitizeReason(s: string): string {
  return s
    .replace(/https?:\/\/[^\s]+/g, '[URL redacted]')
    .replace(/\/(?:Users|home|var|tmp)\/[^\s:]+/g, '[path redacted]');
}
