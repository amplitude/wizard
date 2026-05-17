/**
 * strip-ansi — shared ANSI escape stripping for TUI snapshot/text tests.
 *
 * Background: Ink's `ink-testing-library` `lastFrame()` includes the raw
 * ANSI escapes the component would have emitted to a real terminal. For
 * text-assertion tests (`expect(frame).toContain('Welcome')`) and snapshot
 * tests, we strip those escapes so:
 *
 *   - Assertions don't depend on color codes.
 *   - Snapshots stay readable in PR reviews.
 *   - Output is deterministic on TTY-capable terminals (iTerm2, VS Code)
 *     where Ink also emits OSC 8 hyperlinks via TerminalLink. Without the
 *     OSC strip, `pnpm test -u` on a dev machine bakes hyperlink escapes
 *     into the snapshot and CI (non-TTY) then fails the diff.
 *
 * Two regex flavours:
 *
 *   - CSI: `ESC [ <params> <command-byte>` — color, style, cursor moves.
 *     Almost every Ink test wants this gone.
 *   - OSC: `ESC ] <params> BEL` — OSC 8 hyperlinks. Only emitted by Ink's
 *     `<Text>` `<a>` (TerminalLink) and on real TTYs. Stripping it on
 *     plain CSI-only frames is a no-op, so always-stripping is safe.
 *
 * The exported `stripAnsi` strips both. Callers that want narrower
 * behaviour can use the regexes directly.
 */

// eslint-disable-next-line no-control-regex
export const ANSI_CSI_REGEX = /\x1b\[[0-9;]*[A-Za-z]/g;
// eslint-disable-next-line no-control-regex
export const ANSI_OSC_REGEX = /\x1b\][^\x07]*\x07/g;

/**
 * Strip both CSI (color/style/cursor) and OSC (hyperlink) ANSI escapes.
 *
 * Safe drop-in for the per-file `stripAnsi` helpers scattered across
 * `src/ui/tui/**\/__tests__/*.test.tsx`. CSI-only callsites get a no-op
 * extra `.replace(OSC)` — no semantic change.
 */
export const stripAnsi = (s: string): string =>
  s.replace(ANSI_CSI_REGEX, '').replace(ANSI_OSC_REGEX, '');
