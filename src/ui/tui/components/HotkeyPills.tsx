/**
 * HotkeyPills — high-contrast pill bar for advertising a small set of
 * hotkeys at the foot of a screen.
 *
 * Design intent: the error / cancel outro currently weaves hotkey hints
 * ("press L to open", "Press C to write…", "Press R to retry") into the
 * bulleted troubleshooting list in muted secondary text. Users scanning
 * the screen for "what can I press?" often skim past those bullets
 * because they look like documentation, not interactive affordances.
 *
 * This component pulls the keys out of prose and renders them as a row
 * of accent-coloured `[K] label` pills, mirroring the visual idiom of
 * the global KeyHintBar so users see a familiar "press-this" cue. The
 * troubleshooting bullets above the pill bar stay as-is for context,
 * but the action surface is now one easy-to-find row.
 *
 * Renders nothing when given an empty array — callers don't need to
 * guard the call site for the "no hotkeys" case.
 */

import { Box, Text } from 'ink';
import { Colors } from '../styles.js';

export interface HotkeyPill {
  /** The keyboard key shown inside the brackets (e.g. "L", "Esc"). */
  key: string;
  /** Short verb describing what pressing the key does. */
  label: string;
}

interface HotkeyPillsProps {
  pills: HotkeyPill[];
}

export const HotkeyPills = ({ pills }: HotkeyPillsProps) => {
  if (pills.length === 0) return null;
  return (
    <Box flexDirection="row" gap={2} flexWrap="wrap">
      {pills.map((pill, index) => (
        <Box key={`${index}:${pill.key}`}>
          {/* `[K]` rendered with accent color + bold key glyph so the
              eye picks up the hotkey before the label. Matches the
              KeyHintBar idiom so users see a consistent affordance
              across screens. */}
          <Text color={Colors.accent}>[</Text>
          <Text color={Colors.accent} bold>
            {pill.key}
          </Text>
          <Text color={Colors.accent}>]</Text>
          <Text color={Colors.body}> {pill.label}</Text>
        </Box>
      ))}
    </Box>
  );
};
