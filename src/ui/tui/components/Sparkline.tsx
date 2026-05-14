/**
 * Sparkline — fixed-width ASCII time-series indicator.
 *
 * Used on DataIngestionCheckScreen to show events-per-minute arriving
 * over a 20-minute polling window while the wizard waits for the user's
 * app to start sending data. The sparkline sits alongside the existing
 * "Listening for events…" indicator and gives the user a visual signal
 * that something is (or isn't) flowing.
 *
 * Note: distinct from `utils/sparkline.ts`, which renders the
 * post-success "first chart" sparkline on the outro. That helper uses
 * min/max range normalization and draws a midline for degenerate
 * series; this one uses max-only normalization and intentionally
 * renders nothing for empty / all-zero windows.
 *
 * Rendering rules:
 *
 *   1. Bars use the standard 8-level Unicode block set:
 *        ▁▂▃▄▅▆▇█
 *      Empty ticks (count === 0) render as a single ASCII space so the
 *      line has stable width and the trailing ticks visually "trail off"
 *      as data ages out of the window.
 *
 *   2. The component is pure presentational. It takes `data: number[]`
 *      of up to `width` entries (default 20). All ring-buffer + tick
 *      bookkeeping happens in the caller; the component just renders.
 *
 *   3. Normalization is relative to the max value currently in the
 *      window, so a quiet stream (1–3 events/min) uses the full 8-level
 *      range and is just as visually informative as a noisy one.
 *
 *   4. When EVERY value in the data is zero (including an entirely
 *      empty buffer) the component renders `null` — drawing a row of
 *      spaces would be a phantom UI element that the eye reads as a
 *      bug. Empty = absent, not empty-with-line.
 *
 *   5. Right-aligned: shorter data renders padded with empty cells on
 *      the LEFT, so the newest sample is always at the right edge and
 *      old samples scroll off to the left as the buffer fills.
 */

import { Text } from 'ink';
import { Colors } from '../styles.js';

/** Eight-level Unicode block characters, low → high. */
export const SPARKLINE_BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

/** Empty-cell glyph. A single ASCII space keeps width stable. */
export const SPARKLINE_EMPTY = ' ';

/** Default visible width of the sparkline in cells. */
export const SPARKLINE_DEFAULT_WIDTH = 20;

interface SparklineProps {
  /** Counts in chronological order — oldest first, newest last. */
  data: readonly number[];
  /** Visible cell count. Defaults to 20. */
  width?: number;
  /** Color for the rendered bars. Defaults to the accent tone. */
  color?: string;
}

/**
 * Convert a series of non-negative counts into a fixed-width glyph
 * string. Right-aligned, normalized to the max in the window. Returns
 * an empty string when the data has no positive values — callers
 * should treat that as "render nothing".
 */
export function renderSparkline(
  data: readonly number[],
  width: number = SPARKLINE_DEFAULT_WIDTH,
): string {
  // Take the trailing `width` samples — older entries scroll off the
  // left as the buffer overfills.
  const trimmed = data.slice(-width);
  const max = trimmed.reduce((acc, value) => (value > acc ? value : acc), 0);
  if (max <= 0) return '';

  const levels = SPARKLINE_BARS.length;
  // Map a positive count → 1..levels (so the smallest positive value
  // is still visible at the lowest bar height, not blank). Zero stays
  // zero, which becomes the empty glyph.
  const glyphs = trimmed.map((value) => {
    if (value <= 0) return SPARKLINE_EMPTY;
    const ratio = value / max;
    const idx = Math.min(
      levels - 1,
      Math.max(0, Math.ceil(ratio * levels) - 1),
    );
    return SPARKLINE_BARS[idx];
  });

  // Left-pad with empty cells so the newest sample is always at the
  // right edge and partial windows trail off to the left.
  const padCount = Math.max(0, width - glyphs.length);
  return SPARKLINE_EMPTY.repeat(padCount) + glyphs.join('');
}

export const Sparkline = ({
  data,
  width = SPARKLINE_DEFAULT_WIDTH,
  color = Colors.accent,
}: SparklineProps) => {
  const rendered = renderSparkline(data, width);
  if (rendered.length === 0) return null;
  return <Text color={color}>{rendered}</Text>;
};
