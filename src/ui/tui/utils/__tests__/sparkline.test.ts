/**
 * Bet 5 Slice 4 — ASCII sparkline renderer.
 */

import { describe, it, expect } from 'vitest';
import { renderSparkline } from '../sparkline';

describe('renderSparkline', () => {
  it('renders a monotonic series across the full glyph range', () => {
    const line = renderSparkline([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(line).toBe('▁▂▃▄▅▆▇█');
  });

  it('returns empty string for an empty series', () => {
    expect(renderSparkline([])).toBe('');
  });

  it('filters out non-finite values', () => {
    expect(renderSparkline([NaN, Infinity, -Infinity])).toBe('');
  });

  it('collapses to a midline when all values are identical', () => {
    // Same value → no range → show midline glyph so the user sees something.
    const line = renderSparkline([5, 5, 5, 5]);
    expect(line).toHaveLength(4);
    expect(new Set(line).size).toBe(1);
  });

  it('handles a single-point series without throwing', () => {
    const line = renderSparkline([42]);
    expect(line).toHaveLength(1);
  });

  it('caps output length at maxWidth via downsampling', () => {
    const series = Array.from({ length: 120 }, (_, i) => i);
    const line = renderSparkline(series, { maxWidth: 20 });
    expect([...line]).toHaveLength(20);
  });

  it('represents a V-shape with the lowest glyph at the trough', () => {
    const line = renderSparkline([10, 5, 1, 5, 10]);
    // The midpoint is the trough — should map to the lowest glyph.
    expect([...line][2]).toBe('▁');
    expect([...line][0]).toBe('█');
    expect([...line][4]).toBe('█');
  });

  it('preserves series order (no accidental sort)', () => {
    const line = renderSparkline([100, 1, 100, 1]);
    const chars = [...line];
    expect(chars[0]).toBe('█');
    expect(chars[1]).toBe('▁');
    expect(chars[2]).toBe('█');
    expect(chars[3]).toBe('▁');
  });
});
