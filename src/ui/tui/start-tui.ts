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

  // Swap in the InkUI
  const inkUI = new InkUI(store);
  setUI(inkUI);

  // Render the App — exitOnCtrlC is false so Ctrl+C emits a real SIGINT
  // signal instead of Ink calling process.exit() directly. This lets the
  // SIGINT handler in bin.ts run (checkpoint save, analytics flush, banner).
  const { unmount: inkUnmount } = render(createElement(App, { store }), {
    exitOnCtrlC: false,
  });

  // In raw mode the terminal won't generate SIGINT for Ctrl+C; Ink just
  // delivers the \x03 byte on stdin. Re-raise it as a real signal so the
  // process-level handler fires.
  const onStdinData = (data: Buffer) => {
    if (data[0] === 0x03) {
      process.kill(process.pid, 'SIGINT');
    }
  };
  process.stdin.on('data', onStdinData);

  // Reset terminal colors on exit
  const cleanup = () => {
    process.stdout.write(
      OSC_FG_RESET + OSC_BG_RESET + RESET_ATTRS + CLEAR_SCREEN + CURSOR_HOME,
    );
  };
  process.on('exit', cleanup);

  return {
    unmount: () => {
      process.stdin.off('data', onStdinData);
      inkUnmount();
      cleanup();
    },
    store,
    waitForSetup: () => store.setupComplete,
  };
}
