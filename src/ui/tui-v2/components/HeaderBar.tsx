/**
 * HeaderBar — minimal header line.
 *
 * "Amplitude Wizard" left, org/project right with dot separator.
 * Version moved to /whoami — not needed in-flow.
 */

import { Box, Text } from 'ink';
import { Colors, Icons } from '../styles.js';

interface HeaderBarProps {
  width: number;
  orgName?: string | null;
  projectName?: string | null;
}

export const HeaderBar = ({ width, orgName, projectName }: HeaderBarProps) => {
  const contextParts: string[] = [];
  if (orgName) contextParts.push(orgName);
  if (projectName) contextParts.push(projectName);
  const context = contextParts.join(' / ');

  return (
    <Box width={width} paddingX={1}>
      <Box flexShrink={0}>
        <Text color={Colors.heading} bold>
          Amplitude Wizard
        </Text>
      </Box>
      {context && (
        <Box flexGrow={1} justifyContent="flex-end" overflow="hidden">
          <Text color={Colors.muted}> {Icons.dot} </Text>
          <Text color={Colors.secondary} wrap="truncate-end">
            {context}
          </Text>
        </Box>
      )}
    </Box>
  );
};
