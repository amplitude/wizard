/**
 * KeyHintBar — context-sensitive keyboard shortcut display.
 *
 * Each screen declares its available keys; the bar renders them.
 * Always shows / and Tab hints so users discover commands and questions.
 */

import { Box, Text } from 'ink';
import { Colors } from '../styles.js';

export interface KeyHint {
  key: string; // e.g. "Enter", "/", "Tab", "Esc"
  label: string; // e.g. "Continue", "Commands"
}

interface KeyHintBarProps {
  hints?: KeyHint[];
  width: number;
  showDefaults?: boolean;
  /** When false, hides the "Tab → Ask a question" hint (e.g. before auth). */
  showAskHint?: boolean;
}

const COMMANDS_HINT: KeyHint = { key: '/', label: 'Commands' };
const ASK_HINT: KeyHint = { key: 'Tab', label: 'Ask a question' };

export const KeyHintBar = ({
  hints = [],
  width,
  showDefaults = true,
  showAskHint = true,
}: KeyHintBarProps) => {
  const defaults = showDefaults
    ? showAskHint
      ? [COMMANDS_HINT, ASK_HINT]
      : [COMMANDS_HINT]
    : [];
  const allHints = [...hints, ...defaults];

  return (
    <Box width={width} paddingX={1} gap={2}>
      {allHints.map((hint, index) => (
        <Box key={`${index}:${hint.key}:${hint.label}`}>
          <Text color={Colors.muted}>[</Text>
          <Text color={Colors.body} bold>
            {hint.key}
          </Text>
          <Text color={Colors.muted}>] {hint.label}</Text>
        </Box>
      ))}
    </Box>
  );
};
