/**
 * snapshot-utils — render a TUI screen to a deterministic string for
 * snapshot testing.
 *
 * Why screenshot tests?
 *
 *   The wizard's TUI is a long chain of Ink screens (`src/ui/tui/screens/`).
 *   Today there are no rendered-output tests — only assertions on a few
 *   pure helpers. A change to any layout / copy / color silently slips
 *   through unless someone happens to run `pnpm try` and notice. Snapshot
 *   tests catch unintended visual regressions: every PR that changes a
 *   rendered frame fails until reviewed and updated with `pnpm test -u`.
 *
 * What's deterministic, what's not
 *
 *   The helper renders against a fake stdout (`ink-testing-library`) at a
 *   FIXED 80×24 terminal size, strips ANSI color escapes (so diffs are
 *   readable), and trims trailing whitespace per line. Output is the same
 *   on macOS / Linux / CI.
 *
 *   Things that DO change frame-to-frame:
 *     - Animated spinners (BrailleSpinner) — pass `frame={0}` to pin them
 *     - Date/time text — render with mocked clock or pre-set session state
 *     - Async useEffects (detection, network) — set the post-effect state
 *       on the session before rendering
 *
 *   The helper takes care of ANSI + width + trailing-ws determinism. The
 *   caller is responsible for picking a stable state via `sessionPatch`.
 *
 * Updating a snapshot intentionally
 *
 *   pnpm test -u     # vitest --update; reviews all snapshot diffs first
 *
 *   Or for a single file:
 *
 *   pnpm vitest run src/ui/tui/screens/__tests__/OutroScreen.snap.test.tsx -u
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { render } from 'ink-testing-library';
import type { ReactElement } from 'react';
import { WizardStore } from '../store.js';
import type { WizardSession } from '../store.js';

/**
 * Pin the wizard cache root to a deterministic path BEFORE any screen
 * imports `getLogFilePath()` / `getCacheRoot()`. Without this, OutroScreen's
 * error view renders `<homedir>/.amplitude/wizard/bootstrap.log` — host-
 * specific (`/Users/<name>/...` on macOS, `/home/runner/...` on CI), which
 * would make every snapshot diff between dev and CI.
 *
 * The literal value below is what gets baked into the OutroScreen error
 * snapshot. Don't change it casually — it requires updating the matching
 * snapshot file.
 */
if (!process.env.AMPLITUDE_WIZARD_CACHE_DIR) {
  process.env.AMPLITUDE_WIZARD_CACHE_DIR = '/tmp/wizard-snapshot-cache';
}

/**
 * Per-test-file scratch dir for `installDir`. Some screens (notably
 * AuthScreen's auto-resolve effect) call store mutators that write
 * ampli.json under `session.installDir`. Default `WizardSession.installDir`
 * is `process.cwd()`, which would litter the repo root with a stray
 * ampli.json during tests. Pointing every snapshot store at a tmp dir
 * keeps tests hermetic without forcing each test to set installDir
 * manually.
 */
const SNAPSHOT_INSTALL_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), 'wizard-snapshot-'),
);

/**
 * Strip ANSI escapes so snapshots are readable in PR reviews AND
 * deterministic across TTY-capable / non-TTY runs.
 *
 *   CSI: ESC [ <params> <command-byte>      — color, style, cursor
 *   OSC: ESC ] <params> BEL                 — OSC 8 hyperlinks (TerminalLink)
 *
 * Without the OSC strip, running `pnpm test -u` on a TTY-capable terminal
 * (iTerm2, VS Code) would embed unstripped `\x1b]8;;URL\x07text\x1b]8;;\x07`
 * into snapshots; CI (non-TTY) would then fail with a confusing diff.
 */
// eslint-disable-next-line no-control-regex
const ANSI_CSI_REGEX = /\x1b\[[0-9;]*[A-Za-z]/g;
// eslint-disable-next-line no-control-regex
const ANSI_OSC_REGEX = /\x1b\][^\x07]*\x07/g;
const stripAnsi = (s: string): string =>
  s.replace(ANSI_CSI_REGEX, '').replace(ANSI_OSC_REGEX, '');

/**
 * Trim trailing whitespace from each line. Ink right-pads lines to the
 * terminal width; preserving that padding bloats snapshots and makes
 * diffs unreadable. Leading whitespace is preserved (it's meaningful
 * for layout).
 */
const trimTrailingWs = (s: string): string =>
  s
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n');

export interface RenderedSnapshot {
  /** Sanitized terminal output, ready to feed `toMatchSnapshot()`. */
  frame: string;
  /** The store that was rendered against — useful for follow-up assertions. */
  store: WizardStore;
}

/**
 * Render a TUI screen and return its sanitized last frame.
 *
 * @param element  React element produced by `<ScreenComponent store={...} />`
 * @param store    The store the element was constructed with (so the test
 *                 can mutate it or inspect post-render state).
 */
export function renderSnapshot(
  element: ReactElement,
  store: WizardStore,
): RenderedSnapshot {
  const { lastFrame, unmount } = render(element);
  const raw = lastFrame() ?? '';
  unmount();
  return {
    frame: trimTrailingWs(stripAnsi(raw)),
    store,
  };
}

/**
 * Build a fresh `WizardStore` with optional session overrides. Convenience
 * wrapper so test bodies stay short:
 *
 *     const store = makeStoreForSnapshot({ outroData: { kind: 'success', ... } });
 *     const { frame } = renderSnapshot(<OutroScreen store={store} />, store);
 *     expect(frame).toMatchSnapshot();
 */
export function makeStoreForSnapshot(
  patch: Partial<WizardSession> = {},
): WizardStore {
  const store = new WizardStore();
  // Default to a tmp scratch dir (overridable via patch) so any incidental
  // disk writes from store mutators don't pollute the repo root.
  store.session = {
    ...store.session,
    installDir: SNAPSHOT_INSTALL_DIR,
    ...patch,
  };
  return store;
}
