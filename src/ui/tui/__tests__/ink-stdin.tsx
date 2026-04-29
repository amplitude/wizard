/**
 * ink-stdin — shared helpers for stdin-driven Ink tests.
 *
 * Why this exists
 *
 *   Ink's stdin handling under `ink-testing-library` rides on the
 *   real Node event loop, even when vitest fake timers are active.
 *   That means a `stdin.write('x')` returns synchronously but the
 *   actual `useInput` handler doesn't fire until:
 *     1. the readable stream emits its `data` event (next macrotask),
 *     2. ink dispatches it to the registered handler,
 *     3. React commits the resulting state, and
 *     4. ref-syncing `useEffect`s update `*.current`.
 *
 *   Naively waiting `await new Promise(r => setTimeout(r, 0))` between
 *   keystrokes covers step 1 but not always 2-4. Specifically on Node
 *   20 the macrotask ordering between `stream.write` -> `data` and
 *   the queued `setTimeout(0)` resolution is non-deterministic, so a
 *   second keypress can land while the component is still rendering
 *   the first keypress's state. The result: tests pass on a fast
 *   machine and flake on a slow one. We've burned this exact race in
 *   `LogViewer.snap.test.tsx`; the helper below is the fix.
 *
 *   Use `waitForFrame()` (two `setImmediate` ticks per call — covers
 *   stdin drain + React commit + useEffect flush) instead of an
 *   ad-hoc `setTimeout(0)`. Pair it with `renderInkFrame()` which
 *   waits twice on mount so the first render's `useEffect`s settle
 *   before any input is delivered.
 *
 * When NOT to use this
 *
 *   If your test uses `vi.useFakeTimers()` and drives time forward
 *   with `vi.advanceTimersByTimeAsync()`, that flushes microtasks
 *   for you and you don't need this helper. This helper is for
 *   real-time, stdin-driven interaction tests.
 */

import React from 'react';
import { render } from 'ink-testing-library';

type RenderHandle = ReturnType<typeof render>;
type Stdin = RenderHandle['stdin'];

/**
 * Waits one "frame" — long enough for ink to consume any buffered
 * stdin data, React to commit the resulting state, and
 * ref-syncing `useEffect`s to fire. Two `setImmediate` ticks: the
 * first lets the I/O callback drain, the second lets the resulting
 * commit's `useEffect`s flush before we look at `lastFrame()` or
 * deliver the next char.
 */
export const waitForFrame = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
};

export interface RenderInkFrameOptions {
  /**
   * Optional async function that receives the live stdin handle and a
   * `waitForFrame` helper. Use it to drive keystrokes, awaiting a
   * frame between each `stdin.write` so handlers fire in order.
   */
  interact?: (stdin: Stdin, waitForFrame: () => Promise<void>) => Promise<void>;
}

/**
 * Render an Ink component, optionally drive it via stdin, and return
 * the final frame text. Always waits two frames on mount so the
 * initial render's effects (file reads, async detection, etc.) commit
 * before any input is delivered. Always waits one frame after the
 * `interact` block so the final keystroke's commit lands before
 * `lastFrame()` is captured.
 *
 * The component is unmounted before this resolves — the returned
 * string is the only thing the caller should read.
 *
 * @example
 *   const frame = await renderInkFrame(
 *     <MyScreen filePath={p} />,
 *     {
 *       interact: async (stdin, waitForFrame) => {
 *         stdin.write('g');
 *         await waitForFrame();
 *         stdin.write('n');
 *       },
 *     },
 *   );
 *   expect(frame).toMatchSnapshot();
 */
export const renderInkFrame = async (
  element: React.ReactElement,
  options: RenderInkFrameOptions = {},
): Promise<string> => {
  const view = render(element);
  // First frame: lets the initial render's `useEffect`s run (e.g. a
  // synchronous fs.readFileSync that calls setLines). Second frame:
  // lets the resulting re-render commit and refs sync before any
  // input is delivered.
  await waitForFrame();
  await waitForFrame();
  await options.interact?.(view.stdin, waitForFrame);
  await waitForFrame();
  const frame = view.lastFrame() ?? '';
  view.unmount();
  return frame;
};
