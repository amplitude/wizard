/**
 * Shared graceful-exit logic for Ctrl+C / SIGINT handling.
 *
 * Used by both CtrlCHandler (Ink useInput path) and the process SIGINT
 * handler in bin.ts. Extracting it here keeps the two paths in sync and
 * avoids the Temporal Dead Zone issue that arose when the SIGINT handler
 * referenced a `saveCheckpoint` binding before its dynamic import resolved.
 *
 * Also exposes `installAbortSignalHandler` — the canonical way to wire a
 * SIGINT listener for non-TUI execution modes (agent / CI). The TUI's
 * inline registration in `commands/default.ts` keeps its own copy because
 * it has direct access to the Ink store; agent + CI modes route through
 * this helper so a single user SIGINT lands on every mode's
 * `run_completed: cancelled` envelope, not just the TUI path.
 */

import { saveCheckpoint } from './session-checkpoint.js';
import { analytics } from '../utils/analytics.js';
import {
  abortWizard,
  computeRunDurationMs,
  wizardAbort,
} from '../utils/wizard-abort.js';
import { getUI } from '../ui/index.js';
import type { WizardSession } from './wizard-session';

const EXIT_DELAY_MS = 2_000;

export interface GracefulExitContext {
  session: WizardSession;
  setCommandFeedback: (message: string, ms: number) => void;
}

/**
 * Module-local re-entry guard. The kernel SIGINT handler (bin.ts) and the
 * Ink-rendered Ctrl+C handler (CtrlCHandler.tsx) can both fire from a
 * single user keystroke under certain terminal configurations — without
 * this guard each path queues its own 2s exit timer, double-saves the
 * checkpoint, and double-flushes analytics. A simple "in progress" flag
 * keeps the sequence single-threaded.
 *
 * Exported only for tests. Production callers should never read or
 * mutate this directly.
 */
let _exitInProgress = false;

/** Test-only — reset the re-entry guard between assertions. */
export function _resetGracefulExitForTests(): void {
  _exitInProgress = false;
}

/** Test-only — observe the guard from a test. */
export function _isGracefulExitInProgressForTests(): boolean {
  return _exitInProgress;
}

/**
 * Execute the graceful-exit sequence:
 * 1. Show "Saving session…" banner
 * 2. Abort the wizard-wide AbortController so in-flight async work
 *    (agent SDK query, MCP fetches, ingestion polls) starts unwinding
 *    during the grace window instead of being SIGKILL'd
 * 3. Save session checkpoint (best-effort)
 * 4. Fire-and-forget analytics flush
 * 5. Exit after a fixed 2s grace window
 *
 * Idempotent: a second concurrent call (e.g. SIGINT firing after Ink's
 * Ctrl+C path already started) is a no-op.
 */
export function performGracefulExit(ctx: GracefulExitContext): void {
  if (_exitInProgress) return;
  _exitInProgress = true;

  try {
    ctx.setCommandFeedback(
      'Saving session… press Ctrl+C again to force quit.',
      10_000,
    );
  } catch {
    // store may be mid-teardown; non-fatal
  }

  // Abort the wizard-wide controller BEFORE the grace timer starts so
  // every in-flight subprocess / fetch / poll has the full 2 seconds to
  // unwind. Without this, the SDK subprocess and MCP fetches keep running
  // until process.exit() pulls the rug out from under them, which on
  // some platforms surfaces as zombie processes or half-written files.
  try {
    abortWizard('user cancelled');
  } catch {
    // best-effort
  }

  try {
    saveCheckpoint(ctx.session);
  } catch {
    // best-effort
  }
  void analytics.flush().catch(() => {
    // best-effort
  });

  // Emit the terminal `run_completed: cancelled` NDJSON envelope BEFORE
  // the 2s grace timer + process.exit so an orchestrator reading the
  // stream sees a clean cancel signal instead of an abrupt EOF.
  // Previously this funnel called `process.exit(130)` with no terminal
  // event — a parent agent could not distinguish "user pressed Ctrl+C"
  // from "wizard crashed mid-stream". AgentUI implements
  // `emitRunCompleted`; InkUI / LoggingUI no-op. Wrapped in try/catch
  // so a misbehaving emitter can't block the exit.
  try {
    // `computeRunDurationMs()` reads from AgentUI's `getRunStartedAtMs()`
    // so the duration is the wall-clock length of the wizard run, not
    // the ~0ms it takes for this synchronous exit function to execute.
    // Matches what `wizardAbort` stamps on its own `run_completed`
    // envelope so the two SIGINT paths agree.
    getUI().emitRunCompleted?.({
      outcome: 'cancelled',
      exitCode: 130,
      durationMs: computeRunDurationMs(),
      reason: 'sigint',
    });
  } catch {
    // best-effort — never let UI emission block the grace timer
  }

  setTimeout(() => process.exit(130), EXIT_DELAY_MS);
}

/**
 * Module-local re-entry guard for `installAbortSignalHandler`. Distinct
 * from `_exitInProgress` above: that flag guards the full graceful-exit
 * sequence (which we ONLY run in TUI mode where there's a session to
 * checkpoint). The agent / CI path takes a thinner abort route — no
 * checkpoint, no 2s grace timer — but we still need to be idempotent
 * across double-SIGINT and double-install.
 */
let _abortHandlerInstalled = false;
let _abortInProgress = false;

/** Test-only — reset the install guard between assertions. */
export function _resetAbortHandlerForTests(): void {
  _abortHandlerInstalled = false;
  _abortInProgress = false;
}

/**
 * Install a `SIGINT` listener appropriate for non-TUI execution modes
 * (agent / CI). The first SIGINT:
 *   1. Best-effort saves the session checkpoint.
 *   2. Aborts the wizard-wide AbortController so every in-flight async
 *      operation (SDK query, MCP fetches, ingestion polls) starts
 *      unwinding before the process exits.
 *   3. Routes through `wizardAbort` which emits the terminal
 *      `run_completed: { outcome: 'cancelled', exitCode: 130, reason }`
 *      NDJSON event (AgentUI) and calls `process.exit(130)`.
 *
 * A second SIGINT hard-exits immediately.
 *
 * Idempotent: a second call (e.g. agent + CI bootstraps share the same
 * process for tests) is a no-op.
 *
 * Why not just reuse the TUI's inline `performGracefulExit` path? Agent /
 * CI modes have no Ink store, no `setCommandFeedback`, and no Outro
 * screen to wait on — the 2s "Saving session…" timer there is dead time
 * for an orchestrator. We still call `abortWizard` so the wizard-wide
 * AbortController fires and any in-flight async work unwinds before
 * `wizardAbort` lands `process.exit(130)`.
 *
 * Previously this handler was only installed in the TUI branch of
 * `commands/default.ts`, meaning agent + CI runs got hard-killed by the
 * default Node behaviour — no checkpoint, no terminal NDJSON envelope,
 * and an orchestrator parsing the stream saw an abrupt EOF instead of a
 * clean cancel signal.
 *
 * The `getUI()` call is intentionally avoided here — `wizardAbort` already
 * emits the `run_completed` envelope before `process.exit`, so a direct
 * call here would double-emit. Reference suppressed to discourage future
 * duplication.
 */
export function installAbortSignalHandler(session: WizardSession): void {
  if (_abortHandlerInstalled) return;
  _abortHandlerInstalled = true;

  process.on('SIGINT', () => {
    if (_abortInProgress) {
      process.exit(130);
    }
    _abortInProgress = true;

    // 1. Best-effort save — checkpoint is cheap and only runs when there's
    //    something resumable on disk. Failures are non-fatal.
    try {
      saveCheckpoint(session);
    } catch {
      // best-effort
    }

    // 2. Abort the wizard-wide controller BEFORE wizardAbort so every
    //    in-flight subprocess / fetch / poll starts unwinding while
    //    wizardAbort runs its own teardown (cleanup hooks + analytics
    //    flush). Without this, agent mode's long-running tool calls
    //    keep running until wizardAbort's process.exit pulls the rug.
    try {
      abortWizard('sigint');
    } catch {
      // best-effort
    }

    // 3. Fire-and-forget analytics flush; wizardAbort runs its own
    //    flush under a deadline. Belt-and-suspenders here protects the
    //    cancel breadcrumb in case wizardAbort's flush races
    //    process.exit on a wedged network.
    void analytics.flush().catch(() => {
      // best-effort
    });

    // 4. Route through wizardAbort — it emits the terminal
    //    `run_completed: { outcome: 'cancelled', exitCode: 130,
    //    reason: 'sigint' }` envelope (AgentUI implements; LoggingUI /
    //    InkUI no-op) and then calls process.exit(130).
    void wizardAbortRunner({
      message: 'cancelled by signal',
      exitCode: 130,
      reason: 'sigint',
    });
  });
}

/**
 * Thin wrapper around `wizardAbort` that surfaces the `reason` field
 * (which `wizardAbort` itself sanitizes onto the `run_completed`
 * envelope via its `message` parameter). Kept inline so the SIGINT
 * handler can pass a stable, machine-readable reason string ("sigint")
 * without bleeding into the human-readable message argument.
 *
 * `wizardAbort` is statically imported at the top of this file —
 * `abortWizard` (used by `performGracefulExit` and the SIGINT handler
 * above) lives in the same module, so the `wizard-abort.js` module
 * graph is already eagerly loaded here. The previous dynamic
 * `await import(...)` was a misleading no-op: the module came from the
 * import cache instantly and bought no lazy-loading benefit.
 */
async function wizardAbortRunner(opts: {
  message: string;
  exitCode: number;
  reason: string;
}): Promise<void> {
  // wizardAbort is `Promise<never>` — it always calls `process.exit`
  // and never resolves in production. Wrap in try/catch to silence
  // the unhandled rejection that surfaces when a vitest harness has
  // stubbed `process.exit` to throw (vitest's strict-exit guard does
  // this to catch unintended terminations). In production the throw
  // path never fires; the rejection only ever shows up in tests.
  try {
    await wizardAbort({
      message: opts.message,
      exitCode: opts.exitCode,
      reason: opts.reason,
    });
  } catch {
    // Best-effort: production runs never reach here because wizardAbort
    // calls process.exit. Tests that stub process.exit may surface a
    // synthetic exception — swallowed because the test harness owns
    // the verification (the run_completed envelope + signal state
    // have already been observed by then).
  }
}
