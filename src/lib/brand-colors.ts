/**
 * Brand palette subset for framework glyph colors.
 *
 * These values MUST stay in sync with the canonical Brand object in
 * `src/ui/tui/styles.ts`. They are duplicated here because framework
 * configs live in the CJS module graph while styles.ts is ESM
 * (src/ui/tui/ sets `"type": "module"`).
 */
export const BrandColors = {
  gray10: '#F2F4F8',
  gray40: '#9FA5AD',
  gray60: '#697077',
} as const;
