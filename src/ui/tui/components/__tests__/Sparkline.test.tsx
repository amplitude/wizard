/**
 * Sparkline component tests.
 *
 * The sparkline is the visible signal on DataIngestionCheckScreen that
 * events-per-minute are (or aren't) arriving in the user's project.
 * These tests pin the contract:
 *
 *   1. Renders exactly `width` glyphs for a fully-populated buffer.
 *   2. Normalizes correctly when the max value changes — the tallest
 *      sample always maps to '█', and smaller samples map proportionally
 *      to the 8-level block set.
 *   3. Updates when data changes (re-render produces a new frame).
 *   4. Empty buffer renders NOTHING — not a line of spaces.
 *   5. Right-aligned: partial windows pad with empty cells on the left
 *      so the newest sample is always at the right edge.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import {
  Sparkline,
  renderSparkline,
  SPARKLINE_BARS,
  SPARKLINE_DEFAULT_WIDTH,
  SPARKLINE_EMPTY,
} from '../Sparkline.js';

describe('renderSparkline', () => {
  it('returns an empty string when the buffer is empty', () => {
    expect(renderSparkline([])).toBe('');
  });

  it('returns an empty string when every value is zero', () => {
    expect(renderSparkline([0, 0, 0, 0])).toBe('');
  });

  it('maps the max value to the tallest glyph', () => {
    const out = renderSparkline([1, 2, 4, 8], 4);
    expect(out).toHaveLength(4);
    // 8 is the max → '█'
    expect(out[3]).toBe('█');
    // All other glyphs are valid block characters
    for (const ch of out) {
      expect(SPARKLINE_BARS).toContain(ch);
    }
  });

  it('renders the configured width when the buffer matches it', () => {
    const data = Array.from({ length: 20 }, (_, i) => i + 1);
    const out = renderSparkline(data, 20);
    expect(out).toHaveLength(20);
  });

  it('renders 20 cells by default when data fills the window', () => {
    const data = Array.from({ length: 20 }, () => 5);
    const out = renderSparkline(data);
    expect(out).toHaveLength(SPARKLINE_DEFAULT_WIDTH);
    // Every cell is the same height because every sample equals the max.
    for (const ch of out) {
      expect(ch).toBe('█');
    }
  });

  it('left-pads partial windows so newest sample is at the right edge', () => {
    const out = renderSparkline([10], 5);
    expect(out).toHaveLength(5);
    // First 4 cells are empty spaces, last cell is the tallest glyph.
    expect(out.slice(0, 4)).toBe(SPARKLINE_EMPTY.repeat(4));
    expect(out[4]).toBe('█');
  });

  it('renders zero-count cells as the empty glyph (not a bar)', () => {
    const out = renderSparkline([5, 0, 5], 3);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe('█');
    expect(out[1]).toBe(SPARKLINE_EMPTY);
    expect(out[2]).toBe('█');
  });

  it('re-normalizes when the max changes between renders', () => {
    // First render: max is 2, so the "2" sample maps to '█'.
    const first = renderSparkline([1, 2], 2);
    expect(first[1]).toBe('█');
    expect(first[0]).not.toBe('█');

    // Second render: max is now 10, so the same "2" sample is shorter.
    const second = renderSparkline([1, 2, 10], 3);
    expect(second[2]).toBe('█');
    // Index 1 ("2") is now mapped against max=10 → lower glyph.
    const idx2Glyph = SPARKLINE_BARS.indexOf(
      second[1] as (typeof SPARKLINE_BARS)[number],
    );
    const tallIdx = SPARKLINE_BARS.indexOf('█');
    expect(idx2Glyph).toBeLessThan(tallIdx);
  });

  it('keeps smallest positive values visible at the lowest bar level', () => {
    // With max=100 a value of 1 must still render a visible glyph
    // (not collapse to empty / space) — otherwise low-traffic streams
    // would look identical to silence.
    const out = renderSparkline([1, 100], 2);
    expect(out[0]).toBe(SPARKLINE_BARS[0]); // ▁
    expect(out[1]).toBe('█');
  });

  it('drops oldest samples when data exceeds width', () => {
    // Width 3, but 5 samples — the first two should fall off the left.
    const out = renderSparkline([100, 100, 1, 1, 1], 3);
    expect(out).toHaveLength(3);
    // All remaining are the same value (1), so all render as the tallest
    // glyph relative to that window.
    expect(out).toBe('███');
  });
});

describe('Sparkline component', () => {
  it('renders 20 characters for a known full-width input', () => {
    const data = Array.from({ length: 20 }, (_, i) => i + 1);
    const { lastFrame } = render(<Sparkline data={data} />);
    const frame = lastFrame() ?? '';
    // The rendered line contains exactly the 20-glyph string.
    expect(frame).toContain(renderSparkline(data, 20));
    // 1..20 with max=20 → tallest cell at the right.
    expect(frame).toContain('█');
  });

  it('renders nothing for an empty buffer', () => {
    const { lastFrame } = render(<Sparkline data={[]} />);
    // Ink renders an empty frame (possibly just a trailing newline) when
    // the component returns null. The important guarantee: no bar glyph
    // and no run of spaces masquerading as a sparkline.
    const frame = lastFrame() ?? '';
    for (const bar of SPARKLINE_BARS) {
      expect(frame).not.toContain(bar);
    }
  });

  it('renders nothing when every value is zero', () => {
    const { lastFrame } = render(<Sparkline data={[0, 0, 0, 0, 0]} />);
    const frame = lastFrame() ?? '';
    for (const bar of SPARKLINE_BARS) {
      expect(frame).not.toContain(bar);
    }
  });

  it('updates the rendered frame when new tick data arrives', () => {
    const view = render(<Sparkline data={[1]} width={5} />);
    const first = view.lastFrame() ?? '';
    // After the first tick the only bar is at the rightmost cell.
    expect(first).toContain('█');

    // Append a much larger sample. Normalization shifts so the older
    // "1" is now a shorter glyph and the new sample owns '█'.
    view.rerender(<Sparkline data={[1, 100]} width={5} />);
    const second = view.lastFrame() ?? '';
    expect(second).not.toBe(first);
    expect(second).toContain('█');
    // The lowest-bar glyph for the older sample is present.
    expect(second).toContain(SPARKLINE_BARS[0]);
    view.unmount();
  });

  it('honours the width prop', () => {
    const data = Array.from({ length: 10 }, () => 5);
    const { lastFrame } = render(<Sparkline data={data} width={10} />);
    const frame = lastFrame() ?? '';
    // All 10 cells should be tallest glyph because every sample === max.
    expect(frame).toContain('█'.repeat(10));
  });
});
