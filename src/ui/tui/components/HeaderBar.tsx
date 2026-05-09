/**
 * HeaderBar — minimal header line.
 *
 * "Amplitude Wizard" left, org / project / env right with dot separator.
 */

import { Box, Text } from 'ink';
import { Colors, Icons, Layout } from '../styles.js';
import { brandGradient } from '../utils/terminal-rendering.js';

const HEADER_TITLE = brandGradient('Amplitude Wizard');

interface HeaderBarProps {
  width: number;
  orgName?: string | null;
  projectName?: string | null;
  envName?: string | null;
}

export const HeaderBar = ({
  width,
  orgName,
  projectName,
  envName,
}: HeaderBarProps) => {
  const contextParts: string[] = [];
  if (orgName) contextParts.push(orgName);
  if (projectName) contextParts.push(projectName);
  if (envName) contextParts.push(envName);
  const context = contextParts.join(' / ');

  return (
    // Use the shared `Layout.paddingX` token so the header aligns with
    // the screen content area (also at `Layout.paddingX`). Hard-coding
    // paddingX=1 here while content lived at Layout.paddingX=2 produced
    // the visible "headers hug the edge, content shifted right" gap
    // users called out.
    <Box width={width} paddingX={Layout.paddingX}>
      <Box flexShrink={0}>
        <Text bold>{HEADER_TITLE}</Text>
      </Box>
      {context && (
        <Box flexGrow={1} justifyContent="flex-end" overflow="hidden">
          <Text color={Colors.subtle}> {Icons.dot} </Text>
          <Text color={Colors.secondary} wrap="truncate-end">
            {context}
          </Text>
        </Box>
      )}
    </Box>
  );
};
