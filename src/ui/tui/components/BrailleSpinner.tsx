/**
 * BrailleSpinner — compact animated spinner using braille characters.
 */

import { Text } from 'ink';
import { useState, useEffect } from 'react';
import { SPINNER_FRAMES, SPINNER_INTERVAL, Colors } from '../styles.js';

interface BrailleSpinnerProps {
  color?: string;
  /** External frame index. When provided the spinner skips its own interval
   *  and renders this frame directly — lets callers share a single timer. */
  frame?: number;
  /**
   * When true, render three consecutive frames (offset by +1 and +2) so
   * the spinner occupies three terminal cells instead of one. Useful for
   * prominent positions like the RunScreen header where a single character
   * is too easy to miss.
   */
  wide?: boolean;
}

export const BrailleSpinner = ({
  color = Colors.active,
  frame: frameProp,
  wide = false,
}: BrailleSpinnerProps) => {
  const [internalFrame, setInternalFrame] = useState(0);

  useEffect(() => {
    if (frameProp !== undefined) return;
    const id = setInterval(
      () => setInternalFrame((f) => (f + 1) % SPINNER_FRAMES.length),
      SPINNER_INTERVAL,
    );
    return () => clearInterval(id);
  }, [frameProp]);

  const frame =
    frameProp !== undefined ? frameProp % SPINNER_FRAMES.length : internalFrame;

  if (wide) {
    const n = SPINNER_FRAMES.length;
    const chars =
      SPINNER_FRAMES[frame] +
      SPINNER_FRAMES[(frame + 1) % n] +
      SPINNER_FRAMES[(frame + 2) % n];
    return <Text color={color}>{chars}</Text>;
  }

  return <Text color={color}>{SPINNER_FRAMES[frame]}</Text>;
};
