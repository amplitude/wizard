/**
 * Shared graceful-exit logic for Ctrl+C / SIGINT handling.
 *
 * Used by both CtrlCHandler (Ink useInput path) and the process SIGINT
 * handler in bin.ts. Extracting it here keeps the two paths in sync and
 * avoids the Temporal Dead Zone issue that arose when the SIGINT handler
 * referenced a `saveCheckpoint` binding before its dynamic import resolved.
 */

import { saveCheckpoint } from './session-checkpoint.js';
import { analytics } from '../utils/analytics.js';
import { abortWizard } from '../utils/wizard-abort.js';
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

  setTimeout(() => process.exit(130), EXIT_DELAY_MS);
}
