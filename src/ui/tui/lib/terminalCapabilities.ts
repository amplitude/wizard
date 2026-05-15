/**
 * terminalCapabilities — single source of truth for terminal feature
 * detection in the TUI.
 *
 * Why one module?
 *
 *   Capability checks (`isTTY`, `LANG` parsing, `COLORTERM` reads) were
 *   previously sprinkled across `start-tui.ts`, `DissolveTransition.tsx`,
 *   and various screens. Each callsite re-derived the same answer with
 *   slightly different fallbacks, and there was no single override knob
 *   to force an ASCII / no-color render for CI screenshots or accessibility
 *   testing.
 *
 *   This module exposes a small, pure API. Every function is safe to call
 *   repeatedly, never writes to stdout, and reads `process.env` lazily so
 *   tests can mutate the environment between cases.
 *
 * Overrides
 *
 *   `WIZARD_FORCE_ASCII=1`  forces `supportsUnicode()` (and therefore
 *                            `supportsRoundedCorners()`) to return false.
 *                            Use in CI screenshots, accessibility audits,
 *                            and when targeting a known-broken terminal.
 *
 * Determinism
 *
 *   The functions intentionally do NOT cache their answers across calls.
 *   Tests want to mutate `process.env` between cases and observe the new
 *   answer; caching would force every test to reset module state.
 *   The reads are cheap (env lookups + a few regexes), so the cost of
 *   re-running them is negligible compared to the test-ergonomics win.
 */

/**
 * True when the terminal advertises 24-bit ("truecolor") color via the
 * `COLORTERM` environment variable. We deliberately only match the exact
 * `truecolor` token — `24bit` is also seen in the wild but is rare enough
 * that callers wanting the looser semantic can compose this with their
 * own check.
 *
 * Returns false in non-TTY contexts (CI logs, piped output) since color
 * codes there are noise at best and breakage at worst.
 */
export function supportsTruecolor(): boolean {
  if (!isInteractive()) return false;
  return process.env.COLORTERM === 'truecolor';
}

/**
 * True when the terminal's locale advertises UTF-8 (so unicode glyphs
 * like `❯`, `●`, and box-drawing characters render as intended).
 *
 * Respects the `WIZARD_FORCE_ASCII=1` escape hatch so users on terminals
 * with quirky font fallbacks can opt into the ASCII profile without
 * touching their system locale.
 *
 * Detection order:
 *   1. `WIZARD_FORCE_ASCII=1`        → false (explicit opt-out wins)
 *   2. `LC_ALL` / `LC_CTYPE` / `LANG` contains "utf-8" or "utf8"
 *                                     → true
 *   3. Anything else                  → false (be conservative)
 */
export function supportsUnicode(): boolean {
  if (process.env.WIZARD_FORCE_ASCII === '1') return false;
  // LC_ALL > LC_CTYPE > LANG per POSIX locale precedence. We don't
  // need full POSIX compliance — we just need to find an indicator
  // somewhere on the precedence chain.
  const candidates = [
    process.env.LC_ALL,
    process.env.LC_CTYPE,
    process.env.LANG,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (/utf-?8/i.test(candidate)) return true;
  }
  return false;
}

/**
 * Known terminals where rounded-corner box-drawing characters render
 * as tofu / question marks even when the locale claims UTF-8.
 *
 * Windows Command Prompt (`cmd.exe`, `ConEmu` legacy mode) is the
 * canonical offender. We detect it via `TERM_PROGRAM` and the absence
 * of WT_SESSION (Windows Terminal sets that — and renders rounded
 * corners correctly).
 */
function isKnownBrokenForRoundedCorners(): boolean {
  // Windows Terminal is fine.
  if (process.env.WT_SESSION) return false;
  // The legacy console host on Windows reports `cygwin` or no
  // `TERM_PROGRAM` and `ComSpec` ending in cmd.exe. The simplest
  // heuristic: on win32, treat anything that isn't Windows Terminal
  // as suspect.
  if (process.platform === 'win32') return true;
  return false;
}

/**
 * True when the terminal can render rounded-corner box-drawing characters
 * (`╭ ╮ ╰ ╯`) without falling back to placeholder glyphs.
 *
 * Requires UTF-8 support AND not running in a known-broken terminal
 * (currently: legacy Windows console host).
 */
export function supportsRoundedCorners(): boolean {
  if (!supportsUnicode()) return false;
  if (isKnownBrokenForRoundedCorners()) return false;
  return true;
}

/**
 * True when stdout is attached to an interactive TTY — the precondition
 * for any cursor manipulation, redraw, or animation. CI pipes, log
 * captures, and `--agent` mode all return false here.
 */
export function isInteractive(): boolean {
  return process.stdout.isTTY === true;
}
