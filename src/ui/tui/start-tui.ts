/**
 * start-tui.ts — Sets up the Ink TUI renderer.
 *
 * Uses Amplitude brand colors for terminal theming.
 */

import { render } from 'ink';
import { createElement } from 'react';
import { WizardStore, Flow } from './store.js';
import type { WizardSession } from '../../lib/wizard-session.js';
import { InkUI } from './ink-ui.js';
import { setUI } from '../index.js';
import { App } from './App.js';
import { Brand } from './styles.js';

// ANSI escape sequences
const RESET_ATTRS = '\x1b[0m';
const CLEAR_SCREEN = '\x1b[2J';
const CURSOR_HOME = '\x1b[H';
const BG_BLACK = '\x1b[48;2;0;0;0m';

// OSC 10/11: set terminal foreground/background to Amplitude brand colors
const OSC_FG = `\x1b]10;${Brand.gray10}\x07`;
const OSC_BG = `\x1b]11;${Brand.gray100}\x07`;
// OSC 110/111: reset to user defaults
const OSC_FG_RESET = '\x1b]110;\x07';
const OSC_BG_RESET = '\x1b]111;\x07';

/** Set foreground + background to brand colors, clear screen. */
const FORCE_DARK = OSC_FG + OSC_BG + BG_BLACK + CLEAR_SCREEN + CURSOR_HOME;

/**
 * Probe whether the active terminal can render the OSC 10/11 escape
 * sequences we use to apply the Amplitude brand theme. Returning false
 * skips the theme entirely so terminals that don't support OSC color
 * queries (Windows ConHost pre-build, some legacy SSH stacks, dumb
 * terminals, CI runners) don't see raw `\x1b]10;…\x07` flash on screen
 * before Ink mounts.
 *
 * Honors the `AMPLITUDE_WIZARD_NO_THEME=1` opt-out for users who keep
 * the wizard running on a TTY that lies about its capabilities.
 */
function shouldApplyTheme(): boolean {
  if (process.env.AMPLITUDE_WIZARD_NO_THEME === '1') return false;
  if (!process.stdout.isTTY) return false;
  const term = process.env.TERM ?? '';
  if (term === '' || term === 'dumb' || term === 'xterm-mono') return false;
  return true;
}

export function startTUI(
  version: string,
  flow: Flow = Flow.Wizard,
  initialSession?: WizardSession,
): {
  unmount: () => void;
  store: WizardStore;
  waitForSetup: () => Promise<void>;
} {
  // Apply brand terminal theme — but only when the terminal can actually
  // render the OSC sequences. Otherwise the user sees garbage before Ink
  // mounts on top.
  const themed = shouldApplyTheme();
  if (themed) {
    process.stdout.write(FORCE_DARK);
  }

  const store = new WizardStore(flow);
  store.version = version;
  if (initialSession) {
    store.session = initialSession;
  }

  // Register the live session so process-level safety-net handlers
  // (uncaughtException / unhandledRejection in bin.ts) can save a
  // checkpoint without pulling in the TUI module graph. Best-effort
  // — the safety net works even if this is never called (e.g.
  // agent / CI mode that never mounts the TUI).
  void import('../../utils/active-session.js').then(({ setActiveSession }) => {
    // Pass a getter — not a snapshot — so the safety net always reads
    // the LIVE session at fatal time. Otherwise progress accumulated
    // after registration (region, org/project, framework selection)
    // would be silently dropped from the recovery checkpoint.
    setActiveSession(() => store.session);
  });

  // Swap in the InkUI
  const inkUI = new InkUI(store);
  setUI(inkUI);

  // Render the App — exitOnCtrlC is false so Ctrl+C does NOT call
  // process.exit() directly. Instead, CtrlCHandler (mounted in App via
  // Ink's useInput hook) raises SIGINT so the handler in bin.ts can run
  // its full graceful-exit flow (banner, save checkpoint, flush
  // analytics, force-kill timer).
  //
  // We used to hook stdin.on('data') here to catch the 0x03 byte, but
  // that fought Ink's internal raw-mode reader on some terminals and
  // dropped the keypress entirely. useInput is the supported Ink API
  // and delivers Ctrl+C reliably as `key.ctrl && input === 'c'`.
  const { unmount: inkUnmount } = render(createElement(App, { store }), {
    exitOnCtrlC: false,
  });

  // Reset terminal colors on exit. process.on('exit') doesn't fire on
  // signal-driven exits (SIGINT / SIGTERM / SIGHUP) — without these
  // listeners the user's shell ends up with the wizard's brand background
  // for the rest of the session whenever the wizard is killed by Ctrl+C
  // or a parent agent. Idempotent: `cleanedUp` guards against double
  // emission when both `exit` and a signal fire (process.exit() inside a
  // signal handler triggers `exit`).
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (themed) {
      try {
        process.stdout.write(
          OSC_FG_RESET +
            OSC_BG_RESET +
            RESET_ATTRS +
            CLEAR_SCREEN +
            CURSOR_HOME,
        );
      } catch {
        // EPIPE / closed stdout during shutdown — best-effort cleanup
        // can't surface errors here, the process is on its way down.
      }
    } else {
      // Even when we never applied OSC theming, drop a RESET_ATTRS so
      // any chalk-styled stderr the user saw mid-run doesn't bleed
      // colors into the post-exit shell prompt.
      try {
        process.stdout.write(RESET_ATTRS);
      } catch {
        // Same: best-effort.
      }
    }
  };
  process.on('exit', cleanup);
  // Signal-driven exits skip `exit`. SIGINT / SIGTERM / SIGHUP are the
  // common shutdown signals; install with `once` so a signal received
  // mid-cleanup can't re-enter and double-write.
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.once(sig, cleanup);
  }

  return {
    unmount: () => {
      inkUnmount();
      cleanup();
    },
    store,
    waitForSetup: () => store.setupComplete,
  };
}
