/**
 * Design tokens — Amplitude brand palette + modern TUI primitives.
 *
 * Colors sourced from brand.amplitude.com/creative/color.
 * Optimised for dark terminal backgrounds (Gray 100 base).
 */

// ── Amplitude brand palette ──────────────────────────────────────────

export const Brand = {
  darkBlue: '#001A4F',
  blue: '#1E61F0',
  blueOnDark: '#4083FF', // primary accent on dark backgrounds
  lilac: '#6980FF', // secondary accent, completed states
  violet: '#A373FF', // in-progress, active highlights
  pink: '#FF7D78', // decorative only
  amber: '#F59E0B', // warnings — visually distinct from red
  red: '#F23845', // errors only

  gray100: '#13171A', // terminal background
  gray90: '#242A2E', // card/surface
  gray80: '#373D42', // borders, dividers
  gray70: '#50565B', // disabled text
  gray60: '#697077', // muted text
  gray50: '#868D95', // secondary text
  gray40: '#9FA5AD', // body text
  gray30: '#B9BFC7', // primary text
  gray20: '#D5D9E0', // emphasized text
  gray10: '#F2F4F8', // headings, bright text

  success: '#34D399', // emerald-400 — completion
  white: '#FFFFFF',
} as const;

// ── Semantic color aliases ───────────────────────────────────────────

export const Colors = {
  // Text hierarchy.
  //
  // WCAG AA on the Gray 100 (#13171A) terminal background requires a
  // contrast ratio of at least 4.5:1 for normal-sized text. Brand Gray 60
  // (#697077) measures ~4.1:1 — below the threshold — so instructional
  // copy tagged `Colors.muted` was often hard to read, especially on
  // low-gamut LCDs and sunlit laptops.
  //
  // We bump `muted` to Gray 50 (#868D95, ~6.2:1) to clear AA. Because
  // there isn't a brand gray between Gray 50 and Gray 60 that also
  // passes AA, `muted` and `secondary` now share the same value — they
  // remain as distinct tokens to preserve semantic intent at callsites
  // (instructional copy vs. supporting text), but visually they're one
  // tier. Expect no rendered difference today, and a slight future
  // differentiation if/when we add a mid-gray brand token.
  //
  // `subtle` (old Gray 60 value) is reserved for decorative chrome —
  // separators, ornament glyphs, inactive bullets — that the reader
  // doesn't need to parse. It intentionally does NOT meet AA because it
  // isn't text.
  heading: Brand.gray10,
  body: Brand.gray30,
  secondary: Brand.gray50,
  muted: Brand.gray50, // alias of `secondary` — see comment above
  subtle: Brand.gray60, // decorative chrome only — below AA by design
  disabled: Brand.gray70,

  // Interactive
  accent: Brand.blueOnDark,
  accentSecondary: Brand.lilac,
  active: Brand.violet,

  // Status
  success: Brand.success,
  error: Brand.red,
  warning: Brand.amber,

  // Surfaces
  background: Brand.gray100,
  surface: Brand.gray90,
  border: Brand.gray80,

  // Legacy compat — screens that import Colors.primary
  primary: Brand.blueOnDark,
} as const;

// ── Icons — modern unicode glyphs ───────────────────────────────────

export const Icons = {
  // Progress states
  checkmark: '✓',
  cross: '✗',
  bullet: '●',
  bulletOpen: '○',
  bulletHalf: '◐',
  squareFilled: '◼',
  squareOpen: '◻',

  // Navigation
  chevronRight: '›',
  arrowRight: '→',
  triangleRight: '▶',
  triangleSmallRight: '▸',

  // Decorative
  diamond: '◆',
  diamondOpen: '◇',
  bar: '│',
  dash: '─',
  warning: '⚠',

  // Indicators
  prompt: '❯',
  dot: '·',
  ellipsis: '…',
} as const;

// ── Braille spinner frames ──────────────────────────────────────────

export const SPINNER_FRAMES = [
  '⠋',
  '⠙',
  '⠹',
  '⠸',
  '⠼',
  '⠴',
  '⠦',
  '⠧',
  '⠇',
  '⠏',
] as const;

export const SPINNER_INTERVAL = 200;

// ── Layout constants ────────────────────────────────────────────────

export const Layout = {
  minWidth: 60,
  maxWidth: 120,
  paddingX: 2,
  stepperHeight: 1,
  headerHeight: 1,
  hintBarHeight: 1,
  separatorChar: '─',
} as const;

// ── Alignment ────────────────────────────────────────────────────────

export enum HAlign {
  Left = 'flex-start',
  Center = 'center',
  Right = 'flex-end',
}

export enum VAlign {
  Top = 'flex-start',
  Center = 'center',
  Bottom = 'flex-end',
}
