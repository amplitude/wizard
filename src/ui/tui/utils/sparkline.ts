/**
 * ASCII/Unicode sparkline renderer for the Bet 5 "save your first chart"
 * moment on the success outro.
 *
 * Takes a numeric series and maps it onto one of eight vertical-bar block
 * glyphs (U+2581..U+2588). Empty / single-point / degenerate series collapse
 * to a single middle-level glyph so the outro never shows a broken render.
 */

/** Block characters from smallest (⅛ height) to tallest (full). */
const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

export interface SparklineOptions {
  /** Maximum characters to render. Long series are evenly downsampled. */
  maxWidth?: number;
}

/**
 * Render a numeric series as a sparkline. Returns an empty string for an
 * empty input (caller decides whether to show a placeholder).
 *
 * Negative values are clamped to the observed min so the glyph map stays
 * monotonic. NaN and non-finite values are dropped before rendering.
 */
export function renderSparkline(
  series: readonly number[],
  options: SparklineOptions = {},
): string {
  const { maxWidth = 40 } = options;
  const clean = series.filter((n) => Number.isFinite(n));
  if (clean.length === 0) return '';

  const downsampled = downsample(clean, maxWidth);
  const min = Math.min(...downsampled);
  const max = Math.max(...downsampled);
  const range = max - min;

  if (range === 0) {
    // Every value identical — render a midline so the user sees something
    // rather than a jagged imaginary trend.
    return BLOCKS[3].repeat(downsampled.length);
  }

  return downsampled
    .map((v) => {
      const scaled = (v - min) / range;
      const idx = Math.min(
        BLOCKS.length - 1,
        Math.max(0, Math.round(scaled * (BLOCKS.length - 1))),
      );
      return BLOCKS[idx];
    })
    .join('');
}

/** Evenly pick `width` points from `series`, or return the series as-is
 * when already under width. No smoothing — callers get the raw shape. */
function downsample(series: readonly number[], width: number): number[] {
  if (series.length <= width) return [...series];
  const out: number[] = [];
  const step = series.length / width;
  for (let i = 0; i < width; i++) {
    out.push(series[Math.floor(i * step)]);
  }
  return out;
}
