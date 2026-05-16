/**
 * RunTimelineTodos — todo block for the redesigned RunScreen.
 *
 * Renders up to 5 tasks with the design-kit glyph set:
 *
 *   ✓ done       (Colors.success)
 *   ❯ in progress (Colors.accent)
 *   ○ pending    (Colors.muted)
 *
 * ASCII fallback (`WIZARD_FORCE_ASCII=1`):
 *
 *   *  done
 *   >  in progress
 *   o  pending
 *
 * Voice rules from docs/design/wizard-design-kit.md apply:
 *   - lowercase, first-person, present tense
 *   - the in-progress row shows `task.activeForm` when present; the
 *     done/pending rows show `task.label`
 *
 * The component is intentionally render-only. The composer owns
 * subscription. Pass `tasks` already sliced.
 */

import { Box, Text } from 'ink';
import { Colors } from '../styles.js';
import type { TaskItem } from '../store.js';
import { TaskStatus } from '../../wizard-ui.js';

interface RunTimelineTodosProps {
  tasks: readonly TaskItem[];
  /** ASCII fallback glyph set. */
  ascii?: boolean;
  /** Maximum tasks to render (defaults to 5). */
  max?: number;
}

type Status = TaskItem['status'];

const GLYPHS_UTF8: Record<Status, string> = {
  completed: '✓',
  in_progress: '❯',
  pending: '○',
};

const GLYPHS_ASCII: Record<Status, string> = {
  completed: '*',
  in_progress: '>',
  pending: 'o',
};

const COLORS: Record<Status, string> = {
  completed: Colors.success,
  in_progress: Colors.accent,
  pending: Colors.muted,
};

export const RunTimelineTodos = ({
  tasks,
  ascii = false,
  max = 5,
}: RunTimelineTodosProps) => {
  if (tasks.length === 0) return null;
  const visible = tasks.slice(0, max);
  const glyphSet = ascii ? GLYPHS_ASCII : GLYPHS_UTF8;
  return (
    <Box flexDirection="column">
      {visible.map((task, i) => {
        const status = task.status;
        const label =
          status === TaskStatus.InProgress && task.activeForm
            ? task.activeForm
            : task.label;
        return (
          <Box key={`${i}-${task.label}`} flexDirection="row">
            <Text color={COLORS[status]}>{glyphSet[status]}</Text>
            <Text> </Text>
            <Text
              color={
                status === TaskStatus.Pending ? Colors.muted : Colors.body
              }
            >
              {label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};
