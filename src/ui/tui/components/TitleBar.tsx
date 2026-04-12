import { Box, Text } from 'ink';
import { Colors } from '../styles.js';

const FEEDBACK = 'Feedback: wizard@amplitude.com ';
const FEEDBACK_SHORT = ' wizard@amplitude.com ';

/**
 * Wrap text in an OSC 8 terminal hyperlink escape sequence.
 * Supported by most modern terminals (iTerm2, macOS Terminal, WezTerm, etc.).
 */
function termLink(text: string, url: string): string {
  return `\u001B]8;;${url}\u0007${text}\u001B]8;;\u0007`;
}

interface TitleBarProps {
  version: string;
  width: number;
  orgName?: string | null;
  orgUrl?: string | null;
  projectName?: string | null;
}

export const TitleBar = ({
  version,
  width,
  orgName,
  orgUrl,
  projectName,
}: TitleBarProps) => {
  const fullTitle = ` Amplitude Wizard v${version}`;

  // Build context string from org + project names.
  // Visual length excludes escape sequences used for the hyperlink.
  const contextParts: string[] = [];
  if (orgName) contextParts.push(orgName);
  if (projectName) contextParts.push(projectName);
  const contextVisualLen =
    contextParts.length > 0
      ? contextParts.join(' / ').length + 2 // +2 for surrounding spaces
      : 0;

  const needShort =
    width < fullTitle.length + contextVisualLen + FEEDBACK.length;
  const feedback = needShort ? FEEDBACK_SHORT : FEEDBACK;
  const title =
    needShort && fullTitle.length + contextVisualLen + feedback.length > width
      ? ` Wizard v${version}`
      : fullTitle;

  // If context doesn't fit even with the short title, drop it
  const showContext =
    contextVisualLen > 0 &&
    title.length + contextVisualLen + feedback.length <= width;

  let middleText = '';
  if (showContext) {
    // Wrap org name in a terminal hyperlink when a URL is available
    const displayOrg = orgName && orgUrl ? termLink(orgName, orgUrl) : orgName;
    const displayParts: string[] = [];
    if (displayOrg) displayParts.push(displayOrg);
    if (projectName) displayParts.push(projectName);
    middleText = ` ${displayParts.join(' / ')} `;
  }

  const gap = Math.max(
    0,
    width - title.length - contextVisualLen - feedback.length,
  );
  const padding = ' '.repeat(gap);

  return (
    <Box width={width} overflow="hidden">
      <Text backgroundColor={Colors.accent} color="white" bold>
        {title}
      </Text>
      {showContext ? (
        <Text backgroundColor={Colors.accent} color="white" dimColor>
          {padding}
          {middleText}
        </Text>
      ) : (
        <Text backgroundColor={Colors.accent} color="white">
          {padding}
        </Text>
      )}
      <Text backgroundColor={Colors.accent} color="white" bold>
        {feedback}
      </Text>
    </Box>
  );
};
