/**
 * CtrlCHandler — Intercepts Ctrl+C via Ink's native `useInput` hook and
 * drives the graceful-exit flow directly (banner → save checkpoint →
 * flush analytics → exit).
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
 * On second press within the 2-second window we force-exit immediately.
 */

import { useEffect, useRef } from 'react';
import { useInput } from 'ink';
import { appendFileSync } from 'node:fs';
import type { WizardStore } from '../store.js';
import { saveCheckpoint } from '../../../lib/session-checkpoint.js';
import { analytics } from '../../../utils/analytics.js';

const DEBUG_LOG = '/tmp/amplitude-wizard-ctrlc.log';
const debugLog = (msg: string): void => {
  try {
    appendFileSync(
      DEBUG_LOG,
      `[${new Date().toISOString()}] pid=${process.pid} ${msg}\n`,
    );
  } catch {
    // best-effort
  }
};

interface CtrlCHandlerProps {
  store: WizardStore;
}

export const CtrlCHandler = ({ store }: CtrlCHandlerProps) => {
  const pendingExit = useRef(false);

  useEffect(() => {
    debugLog('mounted — useInput active');
    return () => debugLog('unmounted');
  }, []);

  useInput((input, key) => {
    debugLog(
      `useInput fired: input=${JSON.stringify(input)} ctrl=${key.ctrl} meta=${
        key.meta
      }`,
    );
    if (!(key.ctrl && input === 'c')) return;

    debugLog('Ctrl+C matched — running graceful exit');

    if (pendingExit.current) {
      // Second Ctrl+C — force-kill without waiting
      process.exit(130);
    }
    pendingExit.current = true;

    try {
      store.setCommandFeedback(
        'Saving session… press Ctrl+C again to force quit.',
        10_000, // longer than the 2s force-kill so it never clears early
      );
    } catch {
      // store may be mid-teardown; non-fatal
    }

    // Force-kill after 2 seconds if checkpoint save / analytics flush hangs.
    const forceTimer = setTimeout(() => process.exit(130), 2_000);
    if (forceTimer.unref) forceTimer.unref();

    try {
      saveCheckpoint(store.session);
    } catch {
      // Best-effort — don't block exit
    }

    // Best-effort flush — the force-kill timer bounds the wait
    void analytics.flush().finally(() => process.exit(130));
  });

  return null;
};
