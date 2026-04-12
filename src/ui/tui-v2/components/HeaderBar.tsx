/**
 * HeaderBar — minimal header line.
 *
 * "Amplitude Wizard" left, org/project right. Text only, no background.
 */

import { Box, Text } from 'ink';
import { Colors } from '../styles.js';

interface HeaderBarProps {
  version: string;
  width: number;
  orgName?: string | null;
  projectName?: string | null;
}

export const HeaderBar = ({
  version,
  width,
  orgName,
  projectName,
}: HeaderBarProps) => {
  const left = 'Amplitude Wizard';

  const contextParts: string[] = [];
  if (orgName) contextParts.push(orgName);
  if (projectName) contextParts.push(projectName);
  const context = contextParts.join(' / ');

  const versionStr = `v${version}`;

  return (
    <Box width={width} paddingX={1}>
      <Box flexGrow={1}>
        <Text color={Colors.heading} bold>
          {left}
        </Text>
        <Text color={Colors.disabled}> {versionStr}</Text>
      </Box>
      {context && (
        <Text color={Colors.secondary} wrap="truncate-end">
          {context}
        </Text>
      )}
    </Box>
  );
};
