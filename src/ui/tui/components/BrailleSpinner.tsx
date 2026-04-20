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
}

export const BrailleSpinner = ({
  color = Colors.active,
  frame: frameProp,
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

  return <Text color={color}>{SPINNER_FRAMES[frame]}</Text>;
};
