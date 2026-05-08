/**
 * OrbitSpinner — a 3×3 dot orbiting clockwise around a ring.
 *
 * Renders three terminal rows, so it should be placed in a flex-row
 * container alongside stacked text (use alignItems="flex-start").
 *
 *   · · ·        · ● ·        · · ·
 *   ●   ·   →   ·   ·   →    ·   ●  (etc.)
 *   · · ·        · · ·        · · ·
 */

import { Box, Text } from 'ink';
import { Colors } from '../styles.js';

/** 8 clockwise positions: TL → T → TR → R → BR → B → BL → L */
const ORBIT_POSITIONS: readonly [number, number][] = [
  [0, 0],
  [0, 1],
  [0, 2],
  [1, 2],
  [2, 2],
  [2, 1],
  [2, 0],
  [1, 0],
];

interface OrbitSpinnerProps {
  /** Monotonic tick counter — the spinner derives its own frame from this. */
  tick: number;
  color?: string;
}

export const OrbitSpinner = ({
  tick,
  color = Colors.accent,
}: OrbitSpinnerProps) => {
  const [dotRow, dotCol] = ORBIT_POSITIONS[tick % ORBIT_POSITIONS.length];

  return (
    <Box flexDirection="column">
      {[0, 1, 2].map((r) => (
        <Text key={r} color={color}>
          {[0, 1, 2]
            .map((c) => {
              if (r === dotRow && c === dotCol) return '●';
              if (r === 1 && c === 1) return ' '; // open centre
              return '·';
            })
            .join(' ')}
        </Text>
      ))}
    </Box>
  );
};
