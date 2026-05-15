/**
 * RunTimelineTodos — top-N task list rendered inside the new
 * `RunTimeline` composer (PR 4 of the Timeline UX redesign).
 *
 * Behavior:
 *   - Renders up to `max` tasks (default 5) from the supplied list.
 *   - Status glyphs:
 *       done       → ✓  (ascii: *)
 *       in_progress→ ❯  (ascii: >)
 *       pending    → ○  (ascii: o)
 *   - When `unicode` is false (set by the parent based on the inlined
 *     capability check) every glyph falls back to ASCII.
 *
 * The component is intentionally presentational — the parent
 * `RunTimeline` does the subscription + slicing.
 */

import { Box, Text } from 'ink';
import { Colors } from '../styles.js';
import type { TaskItem } from '../store.js';
import { TaskStatus } from '../../wizard-ui.js';

export interface RunTimelineTodosProps {
  /** Tasks already sliced to the desired length by the parent. */
  tasks: readonly TaskItem[];
  /** Whether to render unicode glyphs (true) or ascii fallbacks (false). */
  unicode: boolean;
}

function glyphFor(status: TaskStatus, unicode: boolean): string {
  if (status === TaskStatus.Completed) return unicode ? '✓' : '*';
  if (status === TaskStatus.InProgress) return unicode ? '❯' : '>';
  return unicode ? '○' : 'o';
}

function colorFor(status: TaskStatus): string {
  if (status === TaskStatus.Completed) return Colors.success;
  if (status === TaskStatus.InProgress) return Colors.active;
  return Colors.muted;
}

function labelFor(task: TaskItem): string {
  // Show the present-continuous form while a step is active so the user
  // sees "Detecting framework…" instead of "Detect framework".
  if (task.status === TaskStatus.InProgress && task.activeForm) {
    return task.activeForm;
  }
  return task.label;
}

export const RunTimelineTodos = ({ tasks, unicode }: RunTimelineTodosProps) => {
  if (tasks.length === 0) return null;
  return (
    <Box flexDirection="column">
      {tasks.map((task, idx) => (
        <Box key={`${idx}-${task.label}`}>
          <Text color={colorFor(task.status)}>{glyphFor(task.status, unicode)} </Text>
          <Text color={task.status === TaskStatus.Completed ? Colors.muted : Colors.body}>
            {labelFor(task)}
          </Text>
        </Box>
      ))}
    </Box>
  );
};
