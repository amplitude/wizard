/**
 * TypewriterFilename behaviour test.
 *
 * Three scenarios:
 *
 *  1. The reveal streams forward one character per
 *     TYPEWRITER_INTERVAL_MS tick, eventually showing the full path.
 *  2. Changing `path` mid-reveal resets the stream — we don't carry
 *     forward the reveal count from the previous path (which would
 *     show garbled "first N chars of new path" before the user has
 *     ever seen the start).
 *  3. Setting `path` to null renders nothing (the slot clears when
 *     the file-write batch finishes).
 */

import React from 'react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'ink-testing-library';
import {
  TypewriterFilename,
  TYPEWRITER_INTERVAL_MS,
} from '../TypewriterFilename.js';

// eslint-disable-next-line no-control-regex
const ANSI_CSI_REGEX = /\x1b\[[0-9;]*[A-Za-z]/g;
const strip = (s: string | undefined) => (s ?? '').replace(ANSI_CSI_REGEX, '');

describe('TypewriterFilename', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reveals the path character-by-character at the typewriter cadence', async () => {
    const view = render(<TypewriterFilename path="src/foo.tsx" />);
    // Initial render — no chars revealed yet; the prefix is shown.
    await vi.advanceTimersByTimeAsync(1);
    let frame = strip(view.lastFrame());
    expect(frame).toContain('editing');
    // The path itself hasn't streamed yet, so no path chars appear
    // adjacent to "editing ".
    expect(frame).not.toContain('src/foo.tsx');

    // Advance enough ticks to reveal three characters.
    await vi.advanceTimersByTimeAsync(TYPEWRITER_INTERVAL_MS * 3 + 5);
    frame = strip(view.lastFrame());
    expect(frame).toContain('editing src');

    // Advance enough to reveal the full path.
    await vi.advanceTimersByTimeAsync(TYPEWRITER_INTERVAL_MS * 20);
    frame = strip(view.lastFrame());
    expect(frame).toContain('editing src/foo.tsx');

    view.unmount();
  });

  it('restarts the reveal when the path changes', async () => {
    const view = render(<TypewriterFilename path="src/foo.tsx" />);
    await vi.advanceTimersByTimeAsync(TYPEWRITER_INTERVAL_MS * 100);
    expect(strip(view.lastFrame())).toContain('editing src/foo.tsx');

    // New path — stream should restart from empty, not pick up where
    // the previous path left off.
    view.rerender(<TypewriterFilename path="lib/bar.py" />);
    await vi.advanceTimersByTimeAsync(1);
    let frame = strip(view.lastFrame());
    // The new path's first chars haven't streamed yet; the previous
    // path's text must be gone.
    expect(frame).not.toContain('src/foo.tsx');
    expect(frame).not.toContain('lib/bar.py');

    await vi.advanceTimersByTimeAsync(TYPEWRITER_INTERVAL_MS * 100);
    frame = strip(view.lastFrame());
    expect(frame).toContain('editing lib/bar.py');

    view.unmount();
  });

  it('renders nothing when path is null', async () => {
    const view = render(<TypewriterFilename path={null} />);
    await vi.advanceTimersByTimeAsync(TYPEWRITER_INTERVAL_MS * 50);
    expect(strip(view.lastFrame()).trim()).toBe('');
    view.unmount();
  });

  it('cancels in-flight timers on unmount', async () => {
    const view = render(<TypewriterFilename path="src/foo.tsx" />);
    await vi.advanceTimersByTimeAsync(TYPEWRITER_INTERVAL_MS * 2);
    view.unmount();
    // Pumping more time after unmount must not throw or schedule
    // additional work. There's nothing to assert on a frame here —
    // the absence of unhandled errors is the contract.
    await vi.advanceTimersByTimeAsync(TYPEWRITER_INTERVAL_MS * 50);
    expect(true).toBe(true);
  });
});
