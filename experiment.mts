import { createElement, useState, useCallback } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';

// ─── Registered commands ───────────────────────────────────────────────────

const COMMANDS: Array<{ cmd: string; desc: string }> = [];

// ─── SlashCommandInput ─────────────────────────────────────────────────────

interface SlashCommandInputProps {
  onSubmit: (value: string) => void;
}

function SlashCommandInput({ onSubmit }: SlashCommandInputProps) {
  const [value, setValue] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const isSlashMode = value.startsWith('/');
  const query = value.slice(1).toLowerCase();
  const filtered = isSlashMode
    ? COMMANDS.filter(
        (c) => c.cmd.slice(1).startsWith(query) || c.desc.toLowerCase().includes(query),
      ).sort((a, b) => {
        const aStarts = a.cmd.slice(1).startsWith(query) ? 0 : 1;
        const bStarts = b.cmd.slice(1).startsWith(query) ? 0 : 1;
        return aStarts - bStarts;
      })
    : [];

  const clampedIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1));

  useInput((char, key) => {
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
        setValue('');
        setSelectedIndex(0);
      } else if (value.trim()) {
        onSubmit(value.trim());
        setValue('');
      }
      return;
    }
    if (key.escape) {
      setValue('');
      setSelectedIndex(0);
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      setSelectedIndex(0);
      return;
    }
    if (key.ctrl || key.meta || key.tab) return;
    if (char) {
      setValue((v) => v + char);
      setSelectedIndex(0);
    }
  });

  const inputDisplay = createElement(
    Box,
    { gap: 1 },
    createElement(Text, { dimColor: true }, '>'),
    createElement(Text, null, value, createElement(Text, { inverse: true }, ' ')),
  );

  const picker =
    isSlashMode && filtered.length > 0
      ? createElement(
          Box,
          { flexDirection: 'column', marginTop: 1 },
          ...filtered.map((c, i) =>
            createElement(
              Box,
              { key: c.cmd, gap: 2 },
              createElement(
                Text,
                { color: i === clampedIndex ? 'cyan' : undefined, bold: i === clampedIndex },
                i === clampedIndex ? '▶ ' + c.cmd : '  ' + c.cmd,
              ),
              createElement(Text, { dimColor: i !== clampedIndex }, c.desc),
            ),
          ),
        )
      : null;

  return createElement(Box, { flexDirection: 'column' }, inputDisplay, picker);
}

// ─── ConsoleView ───────────────────────────────────────────────────────────

function ConsoleView() {
  const { exit } = useApp();
  const [message, setMessage] = useState('');
  const [inputKey, setInputKey] = useState(0);

  const handleSubmit = useCallback((value: string) => {
    setMessage(value);
    setInputKey((k) => k + 1);
  }, []);

  useInput((_char, key) => {
    if (key.ctrl) exit();
  });

  return createElement(
    Box,
    { flexDirection: 'column', gap: 1, borderStyle: 'round', padding: 1 },
    message ? createElement(Text, null, message) : createElement(Text, { dimColor: true }, '(empty)'),
    createElement(SlashCommandInput, { key: inputKey, onSubmit: handleSubmit }),
  );
}

render(createElement(ConsoleView));
