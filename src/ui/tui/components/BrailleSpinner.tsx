/**
 * BrailleSpinner — compact animated spinner using braille characters.
 */

import { Text } from 'ink';
import { useState, useEffect } from 'react';
import { SPINNER_FRAMES, SPINNER_INTERVAL, Colors } from '../styles.js';

interface BrailleSpinnerProps {
  color?: string;
}

export const BrailleSpinner = ({
  color = Colors.active,
}: BrailleSpinnerProps) => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setFrame((f) => (f + 1) % SPINNER_FRAMES.length),
      SPINNER_INTERVAL,
    );
    return () => clearInterval(id);
  }, []);

  return <Text color={color}>{SPINNER_FRAMES[frame]}</Text>;
};
