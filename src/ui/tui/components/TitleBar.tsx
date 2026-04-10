import { Box, Text } from 'ink';
import { Colors } from '../styles.js';

const FEEDBACK = 'Feedback: wizard@amplitude.com ';
const FEEDBACK_SHORT = ' wizard@amplitude.com ';

interface TitleBarProps {
  version: string;
  width: number;
  orgName?: string | null;
  projectName?: string | null;
}

export const TitleBar = ({
  version,
  width,
  orgName,
  projectName,
}: TitleBarProps) => {
  const fullTitle = ` Amplitude Wizard v${version}`;

  // Build context string from org + project names
  const contextParts: string[] = [];
  if (orgName) contextParts.push(orgName);
  if (projectName) contextParts.push(projectName);
  const contextStr =
    contextParts.length > 0 ? ` ${contextParts.join(' / ')} ` : '';

  const needShort =
    width < fullTitle.length + contextStr.length + FEEDBACK.length;
  const feedback = needShort ? FEEDBACK_SHORT : FEEDBACK;
  const title =
    needShort && fullTitle.length + contextStr.length + feedback.length > width
      ? ` Wizard v${version}`
      : fullTitle;

  // If context doesn't fit even with the short title, drop it
  const showContext =
    contextStr.length > 0 &&
    title.length + contextStr.length + feedback.length <= width;
  const middleText = showContext ? contextStr : '';

  const gap = Math.max(
    0,
    width - title.length - middleText.length - feedback.length,
  );
  const padding = ' '.repeat(gap);

  return (
    <Box width={width}>
      <Text backgroundColor={Colors.accent} color="white" bold>
        {title}
      </Text>
      {middleText ? (
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
