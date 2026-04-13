/**
 * EventPlanViewer — Renders a table of planned analytics events.
 */

import { Box, Text } from 'ink';
import type { PlannedEvent } from '../store.js';
import { Colors } from '../styles.js';

interface EventPlanViewerProps {
  events: PlannedEvent[];
}

export const EventPlanViewer = ({ events }: EventPlanViewerProps) => {
  if (events.length === 0) {
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
      {events.map((event) => (
        <Box key={event.name}>
          <Text bold>{event.name}</Text>
          <Text color={Colors.muted}> {event.description}</Text>
        </Box>
      ))}
    </Box>
  );
};
