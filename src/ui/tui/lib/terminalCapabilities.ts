/**
 * terminalCapabilities — minimal feature detection for the new run UI.
 *
 * The new RunScreen redesign (PR: RunTimeline) needs a small set of
 * environment signals to render the right glyphs and color depth. This
 * module exposes two helpers:
 *
 *   - `supportsUnicode()` — true unless `WIZARD_FORCE_ASCII=1` is set or
 *     the runtime locale plainly excludes UTF-8.
 *   - `widthBucket(cols)` — maps a raw column count into named buckets.
 *
 * Kept inline in this PR because the design-kit-level
 * `useTerminalCapabilities()` hook (PR #783 of the closed redesign
 * track) isn't on main yet. When that lands, callers can migrate.
 */

export function supportsUnicode(): boolean {
  if (process.env.WIZARD_FORCE_ASCII === '1') return false;
  const lang =
    process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || '';
  if (!lang) return true;
  return /utf-?8/i.test(lang);
}

/**
 * Width-bucket helper. Mapping the raw column count into named buckets
 * keeps width-responsive branches readable at the call site.
 *
 * Thresholds match the approved RunTimeline mocks:
 *   - 'wide'   >= 100 cols
 *   - 'medium' >=  60 cols
 *   - 'narrow' <   60 cols
 */
export type WidthBucket = 'wide' | 'medium' | 'narrow';

export function widthBucket(cols: number): WidthBucket {
  if (cols >= 100) return 'wide';
  if (cols >= 60) return 'medium';
  return 'narrow';
}
