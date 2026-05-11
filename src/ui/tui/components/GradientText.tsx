/**
 * GradientText — inline single-line text rendered with a left-to-right
 * Amplitude-brand color gradient.
 *
 * Used by the Outro success screen for the celebration heading. The plain
 * green-bold heading didn't sell the moment — this gives "Amplitude is
 * live!" the same brand-on-dark gradient as the AmplitudeTextLogo wordmark
 * shown on IntroScreen, so the wizard's success state feels like
 * Amplitude's success state.
 *
 * Implementation notes
 *
 *  - The gradient interpolates per-character. We render one <Text> node
 *    per character. For headlines on the order of ~30 chars this stays
 *    well below the Yoga node budget that motivated `AmplitudeTextLogo`'s
 *    per-segment optimization.
 *  - Endpoints default to Brand.violet → Brand.blueOnDark, the same
 *    "primary accent on dark backgrounds" pairing the brand palette
 *    advertises (see `styles.ts`). Callers can override for context
 *    (e.g. success → blueOnDark → success-emerald, error → never —
 *    error/cancel outros intentionally keep the minimal monochrome
 *    treatment).
 *  - Bold is configurable but defaults to true: the gradient on its own
 *    can look anemic next to surrounding body text on terminals with
 *    aggressive ANSI dimming.
 */

import { Box, Text } from 'ink';
import { Brand } from '../styles.js';

/** Linearly interpolate between two hex colors. t ∈ [0, 1]. */
function lerpColor(a: string, b: string, t: number): string {
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

interface GradientTextProps {
  /** The text to render with the gradient. */
  children: string;
  /**
   * Left endpoint color (hex). Defaults to the brand violet, which is
   * the "active highlight" tone in the Amplitude palette.
   */
  from?: string;
  /**
   * Right endpoint color (hex). Defaults to the brand "blue on dark",
   * the primary accent for dark terminals.
   */
  to?: string;
  /** Renders the text in bold. Defaults to true. */
  bold?: boolean;
}

export const GRADIENT_TEXT_DEFAULT_FROM = Brand.violet;
export const GRADIENT_TEXT_DEFAULT_TO = Brand.blueOnDark;

export const GradientText = ({
  children,
  from = GRADIENT_TEXT_DEFAULT_FROM,
  to = GRADIENT_TEXT_DEFAULT_TO,
  bold = true,
}: GradientTextProps) => {
  const text = children;
  if (text.length === 0) return null;

  // Per-character interpolation. For headline-length strings this is
  // ~30 nodes and well below the Yoga budget; if a future caller passes
  // a paragraph we should switch to segment-based interpolation as the
  // wordmark does.
  const chars: { ch: string; color: string }[] = [];
  for (let i = 0; i < text.length; i++) {
    const t = text.length > 1 ? i / (text.length - 1) : 0;
    chars.push({ ch: text[i], color: lerpColor(from, to, t) });
  }

  return (
    <Box flexDirection="row">
      {chars.map((c, i) => (
        <Text key={i} color={c.color} bold={bold}>
          {c.ch}
        </Text>
      ))}
    </Box>
  );
};
