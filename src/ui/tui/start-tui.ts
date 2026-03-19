/**
 * start-tui.ts — Sets up the Ink TUI renderer and InkUI.
 */

import { render } from 'ink';
import { createElement } from 'react';
import { WizardStore, Flow } from './store.js';
import type { WizardSession } from '../../lib/wizard-session.js';
import { InkUI } from './ink-ui.js';
import { setUI } from '../index.js';
import { App } from './App.js';

// ANSI escape sequences
const RESET_ATTRS = '\x1b[0m';
const CLEAR_SCREEN = '\x1b[2J';
const CURSOR_HOME = '\x1b[H';
const BG_BLACK = '\x1b[48;2;0;0;0m';
// OSC 10/11: set terminal foreground/background colors (ignored by unsupporting terminals)
const OSC_FG_BRIGHT = '\x1b]10;#e8e8f0\x07';
const OSC_BG_DARK = '\x1b]11;#0d0d16\x07';
// OSC 110/111: reset to user defaults
const OSC_FG_RESET = '\x1b]110;\x07';
const OSC_BG_RESET = '\x1b]111;\x07';

/** Set foreground bright + background near-black, clear screen, cursor to top-left. */
const FORCE_DARK =
  OSC_FG_BRIGHT + OSC_BG_DARK + BG_BLACK + CLEAR_SCREEN + CURSOR_HOME;

export function startTUI(
  version: string,
  flow: Flow = Flow.Wizard,
  initialSession?: WizardSession,
): {
  unmount: () => void;
  store: WizardStore;
  waitForSetup: () => Promise<void>;
} {
  // Force dark background regardless of terminal theme.
  // The UI adapts to whatever size the terminal already is.
  process.stdout.write(FORCE_DARK);

  const store = new WizardStore(flow);
  store.version = version;
  if (initialSession) {
    store.session = initialSession;
  }

  // Swap in the InkUI
  const inkUI = new InkUI(store);
  setUI(inkUI);

  // Render the Ink app
  const { unmount: inkUnmount } = render(createElement(App, { store }));

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
