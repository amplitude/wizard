/**
 * SlashCommandInput — Text input with slash-command picker.
 *
 * When isActive=false (default): renders a dim hint, captures no input.
 * When isActive=true: captures all input, calls onDeactivate on submit/escape.
 *
 * Activation is controlled by the parent (ConsoleView).
 */

import { Box, Text, useInput } from 'ink';
import { useState, useEffect } from 'react';
import { Colors, Icons } from '../styles.js';

export interface SlashCommand {
  cmd: string;
  desc: string;
}

/**
 * Returns true when the current input value should open the slash-command
 * picker. The first whitespace-delimited word must start with '/' AND be a
 * prefix of at least one known command. This prevents file paths like
 * `/lib/config.ts` from triggering slash mode.
 */
export function computeIsSlashMode(
  value: string,
  commands: SlashCommand[],
): boolean {
  const firstWord = value.split(' ')[0] ?? '';
  return (
    firstWord.startsWith('/') &&
    commands.some((c) => c.cmd.startsWith(firstWord))
  );
}

interface SlashCommandInputProps {
  commands?: SlashCommand[];
  isActive: boolean;
  initialValue?: string;
  onSubmit: (value: string) => void;
  onDeactivate: () => void;
}

export const SlashCommandInput = ({
  commands = [],
  isActive,
  initialValue = '',
  onSubmit,
  onDeactivate,
}: SlashCommandInputProps) => {
  const [value, setValue] = useState(initialValue);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(true);

  useEffect(() => {
    if (!isActive) return;
    setCursorVisible(true);
    const id = setInterval(() => setCursorVisible((v) => !v), 530);
    return () => clearInterval(id);
  }, [isActive]);

  const isSlashMode = computeIsSlashMode(value, commands);
  const query = value.slice(1).toLowerCase();
  const filtered = isSlashMode
    ? commands
        .filter(
          (c) =>
            c.cmd.slice(1).startsWith(query) ||
            c.desc.toLowerCase().includes(query),
        )
        .sort((a, b) => {
          const aStarts = a.cmd.slice(1).startsWith(query) ? 0 : 1;
          const bStarts = b.cmd.slice(1).startsWith(query) ? 0 : 1;
          return aStarts - bStarts;
        })
    : [];

  const clampedIndex = Math.min(
    selectedIndex,
    Math.max(0, filtered.length - 1),
  );
  const maxCmdLen = filtered.reduce((m, c) => Math.max(m, c.cmd.length), 0);

  useInput(
    (char, key) => {
      if (key.upArrow && isSlashMode) {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow && isSlashMode) {
        setSelectedIndex((i) => Math.min(filtered.length - 1, i + 1));
        return;
      }
      if (key.return) {
        if (isSlashMode && filtered.length > 0) {
          onSubmit(filtered[clampedIndex].cmd);
        } else if (value.trim()) {
          onSubmit(value.trim());
        }
        setValue('');
        setSelectedIndex(0);
        onDeactivate();
        return;
      }
      if (key.escape) {
        setValue('');
        setSelectedIndex(0);
        onDeactivate();
        return;
      }
      if (key.backspace || key.delete) {
        const next = value.slice(0, -1);
        setValue(next);
        setSelectedIndex(0);
        if (next === '') onDeactivate();
        return;
      }
      if (key.ctrl || key.meta || key.tab) return;
      if (char) {
        setValue((v) => v + char);
        setSelectedIndex(0);
      }
    },
    { isActive },
  );

  if (!isActive) {
    return (
      <Box gap={1}>
        <Text color={Colors.muted}>{'>'}</Text>
        <Text color={Colors.muted} inverse={false}>
          {' '}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text color={Colors.muted}>{'>'}</Text>
        <Text>
          {value}
          {cursorVisible ? <Text inverse> </Text> : <Text> </Text>}
        </Text>
      </Box>
      {isSlashMode && filtered.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {(() => {
            // Show at most MAX_VISIBLE commands, scrolling to keep selection visible
            const MAX_VISIBLE = 6;
            const total = filtered.length;
            let startIdx = 0;
            if (total > MAX_VISIBLE) {
              // Keep selected item in the middle of the visible window
              startIdx = Math.max(
                0,
                Math.min(
                  clampedIndex - Math.floor(MAX_VISIBLE / 2),
                  total - MAX_VISIBLE,
                ),
              );
            }
            const visible = filtered.slice(startIdx, startIdx + MAX_VISIBLE);
            const hasMore = total > MAX_VISIBLE;

            return (
              <>
                {hasMore && startIdx > 0 && (
                  <Text color={Colors.muted}>
                    {'  '}↑ {startIdx} more
                  </Text>
                )}
                {visible.map((c, vi) => {
                  const i = startIdx + vi;
                  const isFocused = i === clampedIndex;
                  return (
                    <Box key={c.cmd} gap={1}>
                      <Text
                        color={isFocused ? Colors.primary : undefined}
                        bold={isFocused}
                      >
                        {isFocused ? Icons.triangleSmallRight : ' '}
                      </Text>
                      <Text
                        color={isFocused ? Colors.primary : undefined}
                        bold={isFocused}
                      >
                        {c.cmd.padEnd(maxCmdLen)}
                      </Text>
                      <Text color={!isFocused ? Colors.muted : undefined}>
                        {c.desc}
                      </Text>
                    </Box>
                  );
                })}
                {hasMore && startIdx + MAX_VISIBLE < total && (
                  <Text color={Colors.muted}>
                    {'  '}↓ {total - startIdx - MAX_VISIBLE} more
                  </Text>
                )}
              </>
            );
          })()}
        </Box>
      )}
    </Box>
  );
};
