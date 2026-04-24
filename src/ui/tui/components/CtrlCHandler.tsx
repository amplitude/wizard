/**
 * CtrlCHandler — Intercepts Ctrl+C via Ink's native `useInput` hook and
 * delegates to the shared `performGracefulExit` helper (banner → save
 * checkpoint → flush analytics → exit after a 2-second grace window).
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
 * The actual exit sequence lives in `src/lib/graceful-exit.ts` and is
 * shared with the process SIGINT handler in bin.ts.
 */

import { useRef } from 'react';
import { useInput } from 'ink';
import type { WizardStore } from '../store.js';
import { performGracefulExit } from '../../../lib/graceful-exit.js';

interface CtrlCHandlerProps {
  store: WizardStore;
}

export const CtrlCHandler = ({ store }: CtrlCHandlerProps) => {
  const pendingExit = useRef(false);

  useInput((input, key) => {
    if (!(key.ctrl && input === 'c')) return;

    if (pendingExit.current) {
      process.exit(130);
    }
    pendingExit.current = true;

    performGracefulExit({
      session: store.session,
      setCommandFeedback: (msg, ms) => store.setCommandFeedback(msg, ms),
    });
  });

  return null;
};
