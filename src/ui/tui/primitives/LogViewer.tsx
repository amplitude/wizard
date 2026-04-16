/**
 * LogViewer — Real-time log tail, pinned to available terminal height.
 * Only renders the last N lines that fit on screen.
 *
 * Lines are color-coded by log level (error → red, warn → amber,
 * success → green). Multi-line entries (JSON bodies, stack traces)
 * inherit the color of their parent timestamp line.
 */

import { Box, Text } from 'ink';
import { Colors } from '../styles.js';
import { useState, useEffect } from 'react';
import * as fs from 'fs';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';

/** Rows consumed by ConsoleView border + TitleBar + spacer + separator + input + tab bar chrome */
const CHROME_ROWS = 8;

const TIMESTAMP_RE = /^\[/;
const ERROR_RE = /\berror\b|\bfail(?:ed)?\b/i;
const WARN_RE = /\bwarn(?:ing)?\b/i;
const SUCCESS_RE = /\bsucceed(?:ed)?\b|\bcompleted?\b/i;

function getLineColor(line: string): string | null {
  if (ERROR_RE.test(line)) return Colors.error;
  if (WARN_RE.test(line)) return Colors.warning;
  if (SUCCESS_RE.test(line)) return Colors.success;
  return null;
}

interface LogViewerProps {
  filePath: string;
  /** Fixed visible height. Defaults to terminal rows minus chrome. */
  height?: number;
}

export const LogViewer = ({ filePath, height }: LogViewerProps) => {
  const [, rows] = useStdoutDimensions();
  const visibleLines = height ?? Math.max(5, rows - CHROME_ROWS);

  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    const readTail = () => {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const allLines = content.split('\n');
        setLines(allLines.slice(-visibleLines));
      } catch {
        setLines(['(No log file found)']);
      }
    };

    readTail();

    let watcher: fs.FSWatcher | undefined;
    try {
      watcher = fs.watch(filePath, () => {
        readTail();
      });
    } catch {
      // File might not exist yet — retry when it appears
      const interval = setInterval(() => {
        try {
          fs.accessSync(filePath);
          readTail();
          clearInterval(interval);
          watcher = fs.watch(filePath, () => readTail());
        } catch {
          // Still waiting
        }
      }, 1000);

      return () => clearInterval(interval);
    }

    return () => {
      watcher?.close();
    };
  }, [filePath, visibleLines]);

  // Pre-render pass: assign colors with carry-forward for multi-line entries
  let currentColor: string = Colors.muted;
  const coloredLines = lines.map((line) => {
    if (TIMESTAMP_RE.test(line)) {
      currentColor = getLineColor(line) ?? Colors.muted;
    }
    return { line, color: currentColor };
  });

  return (
    <Box flexDirection="column" height={visibleLines}>
      {coloredLines.map(({ line, color }, i) => (
        <Text key={i} color={color} wrap="truncate">
          {line}
        </Text>
      ))}
    </Box>
  );
};
