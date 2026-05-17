/**
 * render-frame — `frameOf(node)` convenience for "render-and-read-text"
 * style TUI tests.
 *
 * The pattern this replaces (repeated across ~20 test files):
 *
 *   const { lastFrame, unmount } = render(node);
 *   const out = stripAnsi(lastFrame() ?? '');
 *   unmount();
 *   return out;
 *
 * `frameOf` collapses that into a single call and shares the
 * `stripAnsi` helper from `./strip-ansi`. Tests that need access to the
 * raw `render(...)` return value (stdin, rerender, multi-frame timing)
 * should keep calling `render(...)` directly — this is just a shorthand
 * for the read-once-and-assert path.
 *
 * The function unmounts the rendered tree before returning so per-test
 * Ink trees don't leak between cases. This matches what every callsite
 * was already doing manually.
 */

import type { ReactElement } from 'react';
import { render } from 'ink-testing-library';

import { stripAnsi } from './strip-ansi.js';

/**
 * Render a React element to its last frame as plain (ANSI-stripped) text.
 *
 *   const out = frameOf(<HeaderBar width={80} />);
 *   expect(out).toContain('Amplitude Wizard');
 */
export function frameOf(node: ReactElement): string {
  const { lastFrame, unmount } = render(node);
  const out = stripAnsi(lastFrame() ?? '');
  unmount();
  return out;
}
