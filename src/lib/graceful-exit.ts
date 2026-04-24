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
import type { WizardSession } from './wizard-session';

const EXIT_DELAY_MS = 2_000;

export interface GracefulExitContext {
  session: WizardSession;
  setCommandFeedback: (message: string, ms: number) => void;
}

/**
 * Execute the graceful-exit sequence:
 * 1. Show "Saving session…" banner
 * 2. Save session checkpoint (best-effort)
 * 3. Fire-and-forget analytics flush
 * 4. Exit after a fixed 2s grace window
 */
export function performGracefulExit(ctx: GracefulExitContext): void {
  try {
    ctx.setCommandFeedback(
      'Saving session… press Ctrl+C again to force quit.',
      10_000,
    );
  } catch {
    // store may be mid-teardown; non-fatal
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
