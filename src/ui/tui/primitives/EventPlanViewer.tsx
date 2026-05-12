/**
 * EventPlanViewer — Renders a list of planned analytics events.
 *
 * Each event shows as: ● event name — description
 *
 * The header copy reflects the wiring lifecycle so the Events tab
 * never lies about the agent's state:
 *
 *   - No plan yet           → "Waiting for the agent to propose events..."
 *   - Plan proposed, pending → "Event plan ({N} events) · awaiting your
 *                              approval — see the popup"
 *   - Plan approved, wiring → "Approved · wiring {N} events…"
 *
 * Previously the body said "Waiting for the agent to propose events..."
 * for the entire wiring phase even though the user had already
 * approved — the stale copy made the wizard look stuck.
 */

import { Box, Text } from 'ink';
import type { PlannedEvent } from '../store.js';
import { Colors, Icons } from '../styles.js';

interface EventPlanViewerProps {
  events: PlannedEvent[];
  /**
   * True once the user has hit Y on the EventPlan approval screen.
   * Drives the post-approval header copy. False during the propose +
   * pending-approval window so the existing "review in the popup"
   * affordance stays visible.
   */
  approved?: boolean;
}

export const EventPlanViewer = ({
  events,
  approved = false,
}: EventPlanViewerProps) => {
  const visible = events.filter((e) => e.name.trim().length > 0);
  if (visible.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold>Event plan</Text>
        <Box height={1} />
        <Text color={Colors.muted}>
          Waiting for the agent to propose events...
        </Text>
      </Box>
    );
  }

  const header = approved
    ? `Approved · wiring ${visible.length} event${
        visible.length === 1 ? '' : 's'
      }…`
    : `Event plan (${visible.length} event${
        visible.length === 1 ? '' : 's'
      }) · awaiting your approval`;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>{header}</Text>
      <Box height={1} />
      {visible.map((event) => (
        <Text key={event.name} color={Colors.muted}>
          {Icons.bullet}{' '}
          <Text color={Colors.accent} bold>
            {event.name}
          </Text>
          {event.description ? ` — ${event.description}` : ''}
        </Text>
      ))}
    </Box>
  );
};
