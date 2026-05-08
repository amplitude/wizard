/**
 * ProgressList — Reusable task checklist with status icons.
 * Extracted from StatusTab logic.
 */

import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import { Colors, Icons } from '../styles.js';
import { LoadingBox } from './LoadingBox.js';

export interface ProgressItem {
  label: string;
  activeForm?: string;
  status: 'pending' | 'in_progress' | 'completed';
}

interface ProgressListProps {
  items: ProgressItem[];
  title?: string;
}

export const ProgressList = ({ items, title }: ProgressListProps) => {
  const completed = items.filter((t) => t.status === 'completed').length;
  const total = items.length;

  return (
    <Box flexDirection="column">
      {title && (
        <>
          <Text bold>{title}</Text>
          <Box height={1} />
        </>
      )}
      {items.length === 0 && <LoadingBox message="Analyzing project..." />}
      {items.map((item, i) => {
        const icon =
          item.status === 'completed'
            ? Icons.squareFilled
            : item.status === 'in_progress'
            ? Icons.triangleRight
            : Icons.squareOpen;
        const color =
          item.status === 'completed'
            ? Colors.success
            : item.status === 'in_progress'
            ? Colors.primary
            : Colors.muted;
        // Label-resolution rule (don't break this):
        //   in_progress + activeForm  →  show ONLY the activeForm
        //   anything else              →  show ONLY the canonical label
        // The two strings must NEVER appear concatenated. The activeForm is
        // the "doing" form of the canonical step ("Wiring up event tracking"
        // vs. "Wire up event tracking") — they describe the same step in
        // different tenses, so concatenating them produces gibberish like
        // `Wiring up event trackingto track` (caught on a ~30-col terminal).
        const label =
          item.status === 'in_progress' && item.activeForm
            ? item.activeForm
            : item.label;

        return (
          // Icon and label live in separate boxes so wrapped label lines
          // hang-indent under the first label character instead of resetting
          // to column 0 (which broke the visual hierarchy on long labels).
          //
          // The icon column is given a fixed width (2 cells: glyph + space)
          // so Yoga doesn't collapse the trailing space at narrow widths —
          // that collapse was the trigger for visible smushing between the
          // icon and the label start when the row got tight.
          <Box key={i} flexDirection="row">
            <Box flexShrink={0} width={2}>
              <Text color={color}>{icon}</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              <Text
                color={item.status === 'pending' ? Colors.muted : undefined}
              >
                {label}
              </Text>
            </Box>
          </Box>
        );
      })}
      {total > 0 && (
        <Box marginTop={1} gap={1}>
          {completed < total && <Spinner />}
          <Text color={Colors.muted}>
            Progress: {completed}/{total} completed
          </Text>
        </Box>
      )}
    </Box>
  );
};
