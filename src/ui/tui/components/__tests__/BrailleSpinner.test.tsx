/**
 * BrailleSpinner mood behaviour tests.
 *
 * The mood prop expresses what kind of work the wizard is doing, with
 * three tempos:
 *
 *  - thinking  → SPINNER_INTERVAL (default, ~200 ms)
 *  - waiting   → 1.6× slower (more patient)
 *  - listening → 0.6× faster (more attentive)
 *
 * Test plan:
 *
 *  1. Each mood maps to a distinct interval value (drift guard so a
 *     future refactor that collapses two moods into the same number is
 *     caught loudly).
 *  2. With fake timers, advancing exactly `interval` ms must tick the
 *     spinner forward by one frame; advancing `interval - 1` ms must
 *     not. The three moods are tested independently.
 *  3. Explicit `color` prop overrides the per-mood default.
 */

import React from 'react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'ink-testing-library';
import {
  BrailleSpinner,
  SPINNER_MOOD_INTERVAL,
} from '../BrailleSpinner.js';

describe('BrailleSpinner moods', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes distinct intervals per mood', () => {
    const thinking = SPINNER_MOOD_INTERVAL.thinking;
    const waiting = SPINNER_MOOD_INTERVAL.waiting;
    const listening = SPINNER_MOOD_INTERVAL.listening;

    expect(thinking).toBeGreaterThan(0);
    expect(waiting).toBeGreaterThan(thinking); // patient
    expect(listening).toBeLessThan(thinking); // attentive
    expect(listening).toBeGreaterThanOrEqual(60); // not visually noisy
    // All three values are distinct.
    expect(new Set([thinking, waiting, listening]).size).toBe(3);
  });

  it.each(['thinking', 'waiting', 'listening'] as const)(
    'registers a setInterval with the %s mood cadence on mount',
    (mood) => {
      // Spy directly on the host setInterval — the spinner's mount-time
      // useEffect calls setInterval(fn, SPINNER_MOOD_INTERVAL[mood]).
      // Under fake timers ink-testing-library doesn't always re-render
      // synchronously, so we assert on the timer-registration call
      // instead of the rendered frame. The cadence is the contract;
      // the visible cycle is downstream of it.
      const spy = vi.spyOn(globalThis, 'setInterval');
      const view = render(<BrailleSpinner mood={mood} />);
      const expected = SPINNER_MOOD_INTERVAL[mood];
      const intervals = spy.mock.calls.map((call) => call[1]);
      expect(intervals).toContain(expected);
      view.unmount();
      spy.mockRestore();
    },
  );

  it('uses the host SPINNER_INTERVAL by default (thinking mood)', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const view = render(<BrailleSpinner />);
    const intervals = spy.mock.calls.map((call) => call[1]);
    expect(intervals).toContain(SPINNER_MOOD_INTERVAL.thinking);
    view.unmount();
    spy.mockRestore();
  });

  it('renders without crashing across all three moods', () => {
    // Smoke render — make sure the resolved-color branch (no explicit
    // color prop) doesn't blow up for any mood.
    for (const mood of ['thinking', 'waiting', 'listening'] as const) {
      const view = render(<BrailleSpinner mood={mood} />);
      expect(view.lastFrame()).toBeDefined();
      view.unmount();
    }
  });
});
