/**
 * BrailleSpinner — verifies the three frame-source paths:
 *
 *   1. Explicit `frame` prop — used as-is, no timer.
 *   2. SpinnerFrameContext (App-root provider) — all instances share one
 *      timer, render in-phase, and the provider's interval pauses when
 *      the subscriber count drops to zero.
 *   3. Per-instance fallback — only when neither of the above is present
 *      (e.g. snapshot tests rendering a screen without the provider).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { BrailleSpinner } from '../BrailleSpinner.js';
import { SpinnerFrameProvider } from '../../context/SpinnerFrameContext.js';
import { SPINNER_FRAMES, SPINNER_INTERVAL } from '../../styles.js';

// eslint-disable-next-line no-control-regex
const ANSI_CSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const stripAnsi = (s: string): string => s.replace(ANSI_CSI, '');

describe('BrailleSpinner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the explicit frame when `frame` prop is provided', () => {
    const { lastFrame, unmount } = render(<BrailleSpinner frame={3} />);
    expect(stripAnsi(lastFrame() ?? '').trim()).toBe(SPINNER_FRAMES[3]);
    unmount();
  });

  it('does not start a timer when `frame` prop is provided', () => {
    const intervalSpy = vi.spyOn(global, 'setInterval');
    const { unmount } = render(<BrailleSpinner frame={1} />);
    expect(intervalSpy).not.toHaveBeenCalled();
    unmount();
    intervalSpy.mockRestore();
  });

  it('falls back to a local timer when no provider is mounted', async () => {
    const { lastFrame, unmount } = render(<BrailleSpinner />);
    expect(stripAnsi(lastFrame() ?? '').trim()).toBe(SPINNER_FRAMES[0]);
    await vi.advanceTimersByTimeAsync(SPINNER_INTERVAL * 4);
    expect(stripAnsi(lastFrame() ?? '').trim()).not.toBe(SPINNER_FRAMES[0]);
    unmount();
  });

  it('reads from the shared provider when mounted under one', async () => {
    const { lastFrame, unmount } = render(
      <SpinnerFrameProvider>
        <BrailleSpinner />
      </SpinnerFrameProvider>,
    );
    // Initial frame.
    expect(stripAnsi(lastFrame() ?? '').trim()).toBe(SPINNER_FRAMES[0]);
    // Advance past several intervals — Ink's render throttling means we
    // can't reliably observe every tick, but after enough time has passed
    // the frame must have changed if the provider's timer is firing.
    await vi.advanceTimersByTimeAsync(SPINNER_INTERVAL * 4);
    expect(stripAnsi(lastFrame() ?? '').trim()).not.toBe(SPINNER_FRAMES[0]);
    unmount();
  });

  it('runs only one timer for the entire app, regardless of spinner count', async () => {
    // Multiple spinners + a provider = exactly one setInterval call when
    // the first subscriber registers. Per-instance timers would create
    // N setInterval calls for N spinners.
    const intervalSpy = vi.spyOn(global, 'setInterval');
    const { unmount } = render(
      <SpinnerFrameProvider>
        <BrailleSpinner />
        <BrailleSpinner />
        <BrailleSpinner />
        <BrailleSpinner />
      </SpinnerFrameProvider>,
    );
    // Allow useEffect register() calls to flush.
    await vi.advanceTimersByTimeAsync(0);
    expect(intervalSpy).toHaveBeenCalledTimes(1);
    unmount();
    intervalSpy.mockRestore();
  });

  it('pauses the timer when the subscriber count drops to zero', async () => {
    const ToggleSpinner = ({ visible }: { visible: boolean }) => (
      <SpinnerFrameProvider>
        {visible ? <BrailleSpinner /> : null}
      </SpinnerFrameProvider>
    );

    const intervalSpy = vi.spyOn(global, 'setInterval');
    const clearSpy = vi.spyOn(global, 'clearInterval');

    const { rerender, unmount } = render(<ToggleSpinner visible={true} />);
    await vi.advanceTimersByTimeAsync(0);
    expect(intervalSpy).toHaveBeenCalledTimes(1);

    // No spinners mounted → provider tears the interval down so we don't
    // pay for ticks while the screen has nothing animating.
    rerender(<ToggleSpinner visible={false} />);
    await vi.advanceTimersByTimeAsync(0);
    expect(clearSpy).toHaveBeenCalled();

    unmount();
    intervalSpy.mockRestore();
    clearSpy.mockRestore();
  });

  it('keeps all spinners in-phase under a shared provider', async () => {
    const { lastFrame, unmount } = render(
      <SpinnerFrameProvider>
        <BrailleSpinner />
        <BrailleSpinner />
        <BrailleSpinner />
      </SpinnerFrameProvider>,
    );
    // All three spinners read from the same context value, so they always
    // render the same frame. Whatever frame the provider has settled on
    // after the timer ticks, that single glyph should appear three times
    // in the rendered output.
    await vi.advanceTimersByTimeAsync(SPINNER_INTERVAL * 4);
    const frame = stripAnsi(lastFrame() ?? '').trim();
    // The output is three glyphs separated by whitespace/newlines —
    // split & filter to count distinct non-empty tokens.
    const tokens = frame.split(/\s+/).filter(Boolean);
    expect(tokens.length).toBe(3);
    expect(tokens[0]).toBe(tokens[1]);
    expect(tokens[1]).toBe(tokens[2]);
    unmount();
  });
});
