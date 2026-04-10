/**
 * SplitView — Two-pane layout that adapts to terminal width.
 * Side-by-side at ≥80 cols, stacked vertically below that.
 */

import { Box } from 'ink';
import type { ReactNode } from 'react';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';

const STACK_THRESHOLD = 80;

interface SplitViewProps {
  left: ReactNode;
  right: ReactNode;
  gap?: number;
}

export const SplitView = ({ left, right, gap = 2 }: SplitViewProps) => {
  const [columns] = useStdoutDimensions();
  const stacked = columns < STACK_THRESHOLD;

  if (stacked) {
    return (
      <Box flexDirection="column" flexGrow={1} gap={1}>
        <Box flexDirection="column">{right}</Box>
        <Box flexDirection="column">{left}</Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="row" flexGrow={1} gap={gap}>
      <Box width="50%" flexDirection="column" overflow="hidden">
        {left}
      </Box>
      <Box width="50%" flexDirection="column" overflow="hidden">
        {right}
      </Box>
    </Box>
  );
};
