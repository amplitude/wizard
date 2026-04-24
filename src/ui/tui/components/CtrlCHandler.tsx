/**
 * CtrlCHandler — Intercepts Ctrl+C via Ink's native `useInput` hook and
 * drives the graceful-exit flow directly (banner → save checkpoint →
 * flush analytics → exit after a 2-second grace window).
 *
 * Why this component (rather than a process SIGINT handler in bin.ts)?
 *
 * 1. Ink 6 puts stdin into raw mode, so Ctrl+C does NOT generate a
 *    SIGINT at the kernel level — it's just a byte (0x03). We have to
 *    intercept it via Ink's input pipeline.
 * 2. Relaying through `process.kill(pid, 'SIGINT')` depends on another
 *    handler being installed before the user presses Ctrl+C — a race
 *    that was causing instant-exit on the intro screen.
 * 3. Running the exit logic inside the component guarantees it fires
 *    every time Ink receives Ctrl+C, with no ordering assumptions.
 *
 * Exit timing:
 * - First Ctrl+C: show the banner, kick off save-checkpoint + analytics
 *   flush in the background, then wait a fixed 2 seconds before exiting.
 *   This gives the user a real, visible window to read the banner.
 * - Second Ctrl+C within that window: exit immediately (code 130).
 *
 * IMPORTANT: we deliberately do NOT chain `process.exit` onto
 * `analytics.flush().finally(...)` — flush resolves almost instantly in
 * the common case, which was causing the banner to flash and the
 * process to exit before the user could see it.
 */

import { useRef } from 'react';
import { useInput } from 'ink';
import type { WizardStore } from '../store.js';
import { saveCheckpoint } from '../../../lib/session-checkpoint.js';
import { analytics } from '../../../utils/analytics.js';

const EXIT_DELAY_MS = 2_000;

interface CtrlCHandlerProps {
  store: WizardStore;
}

export const CtrlCHandler = ({ store }: CtrlCHandlerProps) => {
  const pendingExit = useRef(false);

  useInput((input, key) => {
    if (!(key.ctrl && input === 'c')) return;

    if (pendingExit.current) {
      // Second Ctrl+C — force-exit without waiting
      process.exit(130);
    }
    pendingExit.current = true;

    try {
      store.setCommandFeedback(
        'Saving session… press Ctrl+C again to force quit.',
        10_000, // longer than EXIT_DELAY_MS so it never clears early
      );
    } catch {
      // store may be mid-teardown; non-fatal
    }

    // Fire-and-forget cleanup. We do NOT await analytics.flush before
    // exiting — if it resolves instantly the banner flashes invisibly.
    try {
      saveCheckpoint(store.session);
    } catch {
      // best-effort
    }
    void analytics.flush().catch(() => {
      // best-effort
    });

    // Single exit path for the first press: fixed grace window so the
    // banner is visible long enough to read. Do NOT unref — we want
    // this timer to keep the event loop alive until it fires.
    setTimeout(() => process.exit(130), EXIT_DELAY_MS);
  });

  return null;
};
