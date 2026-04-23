/**
 * EventPlanViewer — Renders a list of planned analytics events.
 *
 * Each event shows as: ● event name — description
 */

import { Box, Text } from 'ink';
import type { PlannedEvent } from '../store.js';
import { Colors, Icons } from '../styles.js';

interface EventPlanViewerProps {
  events: PlannedEvent[];
}

export const EventPlanViewer = ({ events }: EventPlanViewerProps) => {
  const visible = events.filter((e) => e.name.length > 0);
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

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Event plan</Text>
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
