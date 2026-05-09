/**
 * ActiveTaskSubsteps — live narration rendered under the active Tasks
 * row in RunScreen.
 *
 * The Tasks list (canonical 4 steps) is the hero of the agent dashboard.
 * Before this component, the active row showed only a chevron + the
 * agent-supplied `activeForm` ("Installing Amplitude…"). What the wizard
 * was actually doing under the hood — reading package.json, running
 * `pnpm add`, editing app/page.tsx — was buried in the Logs tab.
 *
 * This component surfaces the rolling tail of `WizardStore.toolActivities`
 * (populated from inner-agent PreToolUse hooks via `formatToolCallLabel`)
 * as 2-3 indented substep lines:
 *
 *   › Installing Amplitude · 14s
 *      ├─ ✓ Reading package.json
 *      ├─ ✓ Resolved @amplitude/analytics-browser ^2.0.0
 *      ├─ ▸ Running pnpm add …
 *
 * Past-tense rows get ✓ + dim color; the in-progress row gets ▸ + accent.
 *
 * Width-aware: hidden on terminals < 60 cols to save vertical space.
 *
 * Pure component — derives from props alone. Driven by the parent
 * RunScreen's tick interval (no internal state) so re-renders stay in
 * lockstep with the spinner.
 */

import { Box, Text } from 'ink';
import { Colors, Icons } from '../styles.js';
import type { ToolActivity } from '../store.js';

/** Default cap on visible substeps. The store may retain more. */
export const DEFAULT_MAX_SUBSTEPS = 3;

/** Minimum terminal width before substeps render. Below this we save space. */
export const MIN_WIDTH_FOR_SUBSTEPS = 60;

interface ActiveTaskSubstepsProps {
  activities: readonly ToolActivity[];
  /** Terminal width — substeps hide on narrow terminals. */
  width: number;
  /** Cap on visible rows (the buffer may be longer). Default 3. */
  maxVisible?: number;
}

/**
 * Render the trailing N rows of `activities` as indented substeps.
 * Returns `null` when:
 *   - the buffer is empty (nothing to show — no churn before tools fire)
 *   - the terminal is narrow (< MIN_WIDTH_FOR_SUBSTEPS cols)
 *
 * The parent (RunScreen) is responsible for deciding WHEN to render
 * these — only when a task is in_progress. This component doesn't know
 * about task state; it just renders the buffer.
 */
export const ActiveTaskSubsteps = ({
  activities,
  width,
  maxVisible = DEFAULT_MAX_SUBSTEPS,
}: ActiveTaskSubstepsProps) => {
  if (width < MIN_WIDTH_FOR_SUBSTEPS) return null;
  if (activities.length === 0) return null;

  const visible =
    activities.length > maxVisible
      ? activities.slice(activities.length - maxVisible)
      : activities;

  return (
    <Box flexDirection="column">
      {visible.map((activity, i) => {
        // The most-recent in_progress row gets the accent + ▸ indicator;
        // older rows (whether truly completed or just aged out by a
        // newer call) get ✓ + dim. Visual hierarchy: the eye scans
        // straight down to the bottom row, which is the live one.
        const isCurrent =
          activity.status === 'in_progress' && i === visible.length - 1;
        const icon = isCurrent ? Icons.triangleSmallRight : Icons.checkmark;
        const iconColor = isCurrent ? Colors.accent : Colors.success;
        const labelColor = isCurrent ? Colors.body : Colors.muted;
        const dim = !isCurrent;

        return (
          // height={1} pins each row to a single terminal line. Without it,
          // Ink/Yoga gives the row two lines of vertical space whenever a
          // child has flexGrow={1} + truncated text, which produced a blank
          // row between every substep ("the spacing here just looks bad").
          // Substep rows must sit directly under each other so the eye
          // tracks straight down the live narration.
          <Box
            key={`${activity.startedAt}-${i}`}
            flexDirection="row"
            height={1}
          >
            {/* Indent under the parent task's icon column (2 cells in
                ProgressList) plus a 3-cell tree-branch gutter so the
                substeps visually nest beneath the chevron. */}
            <Box flexShrink={0} width={5}>
              <Text color={Colors.subtle}>   {Icons.dash}{Icons.dash} </Text>
            </Box>
            <Box flexShrink={0} width={2}>
              <Text color={iconColor}>{icon}</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              <Text color={labelColor} dimColor={dim} wrap="truncate-end">
                {activity.label}
              </Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};
