/**
 * start-tui.ts v2 — Sets up the v2 Ink TUI renderer.
 *
 * Same function signature as v1 so bin.ts can swap with a conditional import.
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

  // Render the v2 App
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
