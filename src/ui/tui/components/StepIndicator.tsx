/**
 * StepIndicator — generic, capability-aware step rail.
 *
 * Renders a single row of step labels with leading glyphs that encode
 * each step's state:
 *
 *   UTF-8:  `❯ welcome ✓ auth ✓ project ● setup ○ verify ○ done`
 *   ASCII:  `> welcome * auth * project o setup o verify o done`
 *
 * Why a new component when `JourneyStepper` already exists?
 *
 *   `JourneyStepper` is the wizard's persistent top-of-screen progress
 *   indicator. It is tightly coupled to `WizardSession` / `WizardStore`:
 *   it derives its steps from `WIZARD_STEPS`, reads failure state from
 *   `outroData`, and only renders for `Flow.Wizard`.
 *
 *   `StepIndicator` is the generic primitive that the upcoming
 *   `ScreenShell` (PR 1 of the Timeline UX track) and other custom
 *   step rails can compose. It takes a plain `string[]` of step names
 *   plus a numeric `currentIndex` and renders. No store, no flow, no
 *   failure logic. Per the design plan the two coexist intentionally —
 *   `StepIndicator` is the building block, `JourneyStepper` is the
 *   wizard-specific renderer.
 *
 * Rendering rules
 *
 *   - The CURRENT step is prefixed with the prompt glyph (`❯` / `>`),
 *     gets the accent color, and uses `●` / `o` after the prefix.
 *   - COMPLETED steps render with `✓` / `*` in `Colors.muted`.
 *   - FUTURE steps render with `○` / `o` in `Colors.muted`.
 *
 * The glyph set is picked from `supportsUnicode()` at render time. Tests
 * can mutate `process.env.WIZARD_FORCE_ASCII` between cases to verify
 * both profiles.
 */

import { Box, Text } from 'ink';
import { Colors } from '../styles.js';
import { supportsUnicode } from '../lib/terminalCapabilities.js';

export interface StepIndicatorProps {
  /** Ordered list of human-readable step names. */
  steps: string[];
  /**
   * Zero-based index of the active step. Anything below 0 means the rail
   * hasn't entered any step yet (everything renders as future); anything
   * past the last step means every step is complete (no active glyph).
   */
  currentIndex: number;
}

interface Glyphs {
  prompt: string;
  completed: string;
  active: string;
  future: string;
}

const UNICODE_GLYPHS: Glyphs = {
  prompt: '❯',
  completed: '✓',
  active: '●',
  future: '○',
};

const ASCII_GLYPHS: Glyphs = {
  prompt: '>',
  completed: '*',
  active: 'o',
  future: 'o',
};

export const StepIndicator = ({ steps, currentIndex }: StepIndicatorProps) => {
  const glyphs = supportsUnicode() ? UNICODE_GLYPHS : ASCII_GLYPHS;

  return (
    <Box flexDirection="row" flexWrap="wrap">
      {steps.map((step, i) => {
        const isActive = i === currentIndex;
        const isCompleted = i < currentIndex;

        const glyph = isActive
          ? glyphs.active
          : isCompleted
            ? glyphs.completed
            : glyphs.future;

        const color = isActive ? Colors.accent : Colors.muted;

        return (
          <Box key={`${i}:${step}`} marginRight={1}>
            {isActive && (
              // The arrow prefix makes the active step jump out even on
              // monochrome terminals where the color difference between
              // active and muted may be subtle. Pair it with a space so
              // the prompt and dot don't visually fuse.
              <Text color={Colors.accent} bold>
                {glyphs.prompt}{' '}
              </Text>
            )}
            <Text color={color} bold={isActive}>
              {glyph} {step}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};
