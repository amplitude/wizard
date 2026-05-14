/**
 * Color interpolation utilities for TUI gradients.
 *
 * Currently the only consumer surface is gradient text rendering —
 * `GradientText` (the headline wordmark on Outro success) and
 * `AmplitudeTextLogo` (the cold-start splash) both interpolate
 * between two brand-color stops per character. Extracted to a shared
 * module so a future patch (hex shorthand, clamping, alpha) lands
 * in one place instead of two byte-identical clones.
 */

/**
 * Linearly interpolate between two `#rrggbb` hex colors at parameter
 * `t ∈ [0, 1]`. Returns the result as a lowercase `#rrggbb` string.
 *
 * Caller responsibilities:
 *  - Both inputs must be 7-char `#rrggbb` strings (no 3-char shorthand,
 *    no alpha). Out-of-format inputs return `NaN`-bearing garbage —
 *    the function does not validate.
 *  - `t` is not clamped. Callers pass `i / (n - 1)` for n-step gradients
 *    which is always in-range; out-of-range `t` extrapolates linearly.
 */
export function lerpColor(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);

  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);

  return `#${r.toString(16).padStart(2, '0')}${g
    .toString(16)
    .padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}
