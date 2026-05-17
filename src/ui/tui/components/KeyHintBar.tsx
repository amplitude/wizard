/**
 * KeyHintBar — context-sensitive keyboard shortcut display.
 *
 * Each screen declares its available keys; the bar renders them.
 * Always shows / and Tab hints so users discover commands and questions.
 *
 * The `KeyHintInline` helper renders a single `[K] label` element in the
 * same style for use within screen content (e.g. the OAuth-wait hints,
 * timeout confirmations) where embedding the full KeyHintBar would be
 * out of place.
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

/**
 * Render one `[K] label` hint inline. Use within screen content for
 * one-off hotkey advertisements; the persistent footer bar at the
 * bottom of the layout is `KeyHintBar` itself.
 */
export const KeyHintInline = ({
  hint,
  label,
  gap,
}: {
  hint: string;
  label: string;
  gap?: number;
}) => (
  <Box gap={gap}>
    <Text color={Colors.muted}>[</Text>
    <Text color={Colors.body} bold>
      {hint}
    </Text>
    <Text color={Colors.muted}>] {label}</Text>
  </Box>
);

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
        <KeyHintInline
          key={`${index}:${hint.key}:${hint.label}`}
          hint={hint.key}
          label={hint.label}
        />
      ))}
    </Box>
  );
};
