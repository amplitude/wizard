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

export function startTUI(
  version: string,
  flow: Flow = Flow.Wizard,
  initialSession?: WizardSession,
): {
  unmount: () => void;
  store: WizardStore;
  waitForSetup: () => Promise<void>;
} {
  // Apply brand terminal theme
  process.stdout.write(FORCE_DARK);

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
    setActiveSession(store.session);
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

  // Reset terminal colors on exit
  const cleanup = () => {
    process.stdout.write(
      OSC_FG_RESET + OSC_BG_RESET + RESET_ATTRS + CLEAR_SCREEN + CURSOR_HOME,
    );
  };
  process.on('exit', cleanup);

  return {
    unmount: () => {
      inkUnmount();
      cleanup();
    },
    store,
    waitForSetup: () => store.setupComplete,
  };
}
