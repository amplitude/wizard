/**
 * ProgressList — Reusable task checklist with status icons.
 * Extracted from StatusTab logic.
 *
 * Optional `renderActiveSubsteps` slot: when provided, the function is
 * invoked once for the in_progress row and its output is rendered
 * directly beneath that row (between it and the next task). Used by the
 * RunScreen to surface live tool-call narration ("Reading
 * package.json", "Running pnpm add …") under the active task without
 * coupling this primitive to wizard-specific state.
 */

import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
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
  /**
   * Optional render-prop invoked for the in_progress task to inject
   * substep / activity rows beneath it. Returns null to render nothing.
   * Only the first in_progress row receives the slot — if the agent's
   * journey state ever has multiple in_progress (shouldn't, but
   * defensive) only the first gets substeps.
   */
  renderActiveSubsteps?: (item: ProgressItem) => ReactNode;
}

export const ProgressList = ({
  items,
  title,
  renderActiveSubsteps,
}: ProgressListProps) => {
  const completed = items.filter((t) => t.status === 'completed').length;
  const total = items.length;

  // Track the first in_progress index so only that row receives the
  // substeps slot (defensive against the rare double in_progress state —
  // sequential cascade in WizardStore should already prevent this, but
  // a render-time gate is cheap insurance).
  const firstInProgressIndex = items.findIndex(
    (it) => it.status === 'in_progress',
  );

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
        // Glyph language matches JourneyStepper: ✓ for completed, ›
        // (chevron) for in-progress, and a blank gutter for pending so
        // the eye scans straight down the active and finished items
        // instead of being snagged by a stray bullet column on every
        // not-yet-started row.
        const icon =
          item.status === 'completed'
            ? Icons.checkmark
            : item.status === 'in_progress'
            ? Icons.chevronRight
            : ' ';
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

        const substeps =
          renderActiveSubsteps && i === firstInProgressIndex
            ? renderActiveSubsteps(item)
            : null;

        return (
          // Icon and label live in separate boxes so wrapped label lines
          // hang-indent under the first label character instead of resetting
          // to column 0 (which broke the visual hierarchy on long labels).
          //
          // The icon column is given a fixed width (2 cells: glyph + space)
          // so Yoga doesn't collapse the trailing space at narrow widths —
          // that collapse was the trigger for visible smushing between the
          // icon and the label start when the row got tight.
          <Box key={i} flexDirection="column">
            <Box flexDirection="row">
              <Box flexShrink={0} width={2}>
                <Text color={color}>{icon}</Text>
              </Box>
              <Box flexGrow={1} flexShrink={1}>
                <Text
                  color={item.status === 'pending' ? Colors.muted : undefined}
                  dimColor={item.status === 'pending'}
                >
                  {label}
                </Text>
              </Box>
            </Box>
            {substeps}
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
