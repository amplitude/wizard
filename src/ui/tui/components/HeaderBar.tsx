/**
 * HeaderBar — minimal header line.
 *
 * Layout (left → right):
 *   "Amplitude Wizard"  ·  [mode badge]  ·  org / project / env
 *
 * The mode badge is part of the v2 PR 5 redesign — surfaces whether the
 * wizard is running interactively, in `--agent`, `--ci`, MCP-server, or
 * nested inside another Claude Agent session. Not visible in plain
 * interactive mode (the default) so we don't clutter the chrome with a
 * redundant "interactive" label.
 *
 * Note: badge resolution reads `process.env` once at render time. The
 * env doesn't change mid-process for these flags, so a static reading
 * is correct and avoids re-rendering the whole header on every store
 * tick.
 */

import { Box, Text } from 'ink';
import { Colors, Icons, Layout } from '../styles.js';
import { brandGradient } from '../utils/terminal-rendering.js';
import { resolveMode, type ResolvedMode } from '../utils/mode-badge.js';

const HEADER_TITLE = brandGradient('Amplitude Wizard');

interface HeaderBarProps {
  width: number;
  orgName?: string | null;
  projectName?: string | null;
  envName?: string | null;
  /**
   * Override the resolved mode. Tests pass an explicit value;
   * production callsites omit this and let `resolveMode()` read env.
   */
  mode?: ResolvedMode;
}

export const HeaderBar = ({
  width,
  orgName,
  projectName,
  envName,
  mode,
}: HeaderBarProps) => {
  const contextParts: string[] = [];
  if (orgName) contextParts.push(orgName);
  if (projectName) contextParts.push(projectName);
  if (envName) contextParts.push(envName);
  const context = contextParts.join(' / ');

  const resolved = mode ?? resolveMode();
  // Suppress the badge in plain interactive mode — it's the default and
  // showing "interactive" on every header line would just be noise.
  const showBadge = resolved.key !== 'interactive';

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
      {showBadge && (
        <Box flexShrink={0} marginLeft={1}>
          <Text color={Colors.subtle}>[</Text>
          <Text color={resolved.color} bold>
            {resolved.label}
          </Text>
          <Text color={Colors.subtle}>]</Text>
        </Box>
      )}
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
