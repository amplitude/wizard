/**
 * KeyHintBar — context-sensitive keyboard shortcut display.
 *
 * Each screen declares its available keys; the bar renders them.
 * Always shows / and Tab hints so users discover commands + AI query.
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
}

const DEFAULT_HINTS: KeyHint[] = [
  { key: '/', label: 'Commands' },
  { key: 'Tab', label: 'Ask AI' },
];

export const KeyHintBar = ({
  hints = [],
  width,
  showDefaults = true,
}: KeyHintBarProps) => {
  const allHints = [...hints, ...(showDefaults ? DEFAULT_HINTS : [])];

  return (
    <Box width={width} paddingX={1} gap={2}>
      {allHints.map((hint) => (
        <Box key={hint.key + hint.label}>
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
