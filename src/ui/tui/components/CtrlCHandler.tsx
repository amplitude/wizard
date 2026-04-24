/**
 * CtrlCHandler — Intercepts Ctrl+C via Ink's native `useInput` hook and
 * raises a process SIGINT so the handler in bin.ts fires (banner, save
 * checkpoint, flush analytics, then exit).
 *
 * Why a component (rather than a raw `process.stdin.on('data', ...)` in
 * start-tui)?
 *
 * Ink puts stdin into raw mode and owns it. When raw mode is on, the
 * kernel does NOT generate SIGINT for Ctrl+C — it's just a byte (0x03).
 * Attaching an external `data` listener can race with Ink's own reader
 * and is reported to sometimes miss the byte entirely on certain
 * terminals / Node builds. `useInput` is the supported Ink API for
 * reading keyboard events, so Ctrl+C is reliably delivered as a normal
 * key event (`key.ctrl && input === 'c'`). We then raise SIGINT
 * ourselves, which the bin.ts handler consumes.
 */

import { useInput } from 'ink';

export const CtrlCHandler = () => {
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      // Raise SIGINT so the handler in bin.ts runs exactly once with its
      // full graceful-exit flow (banner via setCommandFeedback, save
      // checkpoint, flush analytics, force-kill timer, second-press
      // fast-exit). The handler is idempotent via its own
      // `sigintReceived` flag, so a double-press still force-exits.
      process.kill(process.pid, 'SIGINT');
    }
  });
  return null;
};
