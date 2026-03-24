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

  const isSlashMode = value.startsWith('/');
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
          {filtered.map((c, i) => (
            <Box key={c.cmd} gap={2}>
              <Text
                color={i === clampedIndex ? Colors.primary : undefined}
                bold={i === clampedIndex}
              >
                {i === clampedIndex
                  ? Icons.triangleSmallRight + ' ' + c.cmd
                  : '  ' + c.cmd}
              </Text>
              <Text color={i !== clampedIndex ? Colors.muted : undefined}>
                {c.desc}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};
