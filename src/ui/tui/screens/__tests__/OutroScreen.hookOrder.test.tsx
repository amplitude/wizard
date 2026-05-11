/**
 * OutroScreen rules-of-hooks pinning test.
 *
 * Pre-fix layout:
 *   const [reportExists, setReportExists] = useState(false);   // top hook
 *   …
 *   if (!outroData) return <FinishingUp />;                    // early return
 *   …
 *   useEffect(() => { setReportExists(fs.existsSync(...)); }); // BELOW return
 *
 * That violates the rules of hooks: the `outroData == null` render
 * called one fewer hook than the happy path, so the null → success
 * transition would trip React's "Rendered fewer hooks than expected"
 * console.error. The fix hoists the `reportExists` useEffect above the
 * early return so the hook order is stable across renders.
 *
 * The test mounts OutroScreen with `outroData = null`, then flips the
 * store to a success outroData and asserts:
 *   - no console.error matching "Rendered .* hooks" fires
 *   - the success view actually renders (sanity check that the test
 *     didn't break in a way that hides the regression)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { OutroScreen } from '../OutroScreen.js';
import { makeStoreForSnapshot } from '../../__tests__/snapshot-utils.js';
import { OutroKind } from '../../session-constants.js';

// The exact `ReturnType<typeof vi.spyOn>` for `console.error` infers as
// `any` through Vitest's overload resolution, which trips
// `no-unsafe-*` lint rules across the test body. A narrow declared
// shape keeps the type checker happy without `eslint-disable` blocks.
interface ConsoleErrorSpy {
  mockRestore(): void;
  mock: { calls: unknown[][] };
}

describe('OutroScreen — rules-of-hooks invariant', () => {
  let consoleErrorSpy: ConsoleErrorSpy;

  beforeEach(() => {
    // Real timers — useEffect commits ride the React scheduler, which
    // uses microtasks rather than `setTimeout`. We poll the rendered
    // frame after a couple of frame ticks to let the effect land.
    consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {}) as unknown as ConsoleErrorSpy;
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('does not log a rules-of-hooks warning when outroData transitions null → success', async () => {
    // Start with outroData == null — the early-return branch the
    // pre-fix code took. The 'Finishing up…' fallback view must
    // render WITHOUT a hook-order warning.
    const store = makeStoreForSnapshot({
      outroData: null,
    });

    const view = render(<OutroScreen store={store} />);

    // Yield a frame so React can commit the first render.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    // Flip outroData to a success payload — the happy path that runs
    // every hook past the (former) early-return site. Without the
    // hoist fix, this transition triggered the "Rendered more hooks
    // than during the previous render" error.
    store.setOutroData({
      kind: OutroKind.Success,
      changes: ['Installed @amplitude/analytics-browser'],
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    // No console.error matching the React rules-of-hooks string.
    const hookOrderErrors = consoleErrorSpy.mock.calls.filter((call) =>
      call.some(
        (arg) =>
          typeof arg === 'string' &&
          /Rendered (more|fewer) hooks than/.test(arg),
      ),
    );
    expect(hookOrderErrors).toEqual([]);

    // Sanity: the success branch actually rendered. If we hid the
    // regression by accidentally short-circuiting the test, this
    // would still pass — so we additionally verify the screen swapped
    // out of the loading text.
    const frame = view.lastFrame() ?? '';
    expect(frame).not.toMatch(/^Finishing up/);

    view.unmount();
  });
});
