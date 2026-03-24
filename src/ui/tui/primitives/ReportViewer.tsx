/**
 * ReportViewer — Scrollable viewer for amplitude-setup-report.md.
 *
 * Reads the file from disk and displays it with basic markdown rendering
 * (headings bold, bullet points preserved). Supports up/down scrolling
 * via arrow keys or j/k vim keys.
 */

import { Box, Text } from 'ink';
import { useState, useEffect } from 'react';
import * as fs from 'fs';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { Colors } from '../styles.js';

/** Rows consumed by ConsoleView border + TitleBar + separator + tab bar chrome */
const CHROME_ROWS = 10;

interface ReportViewerProps {
  filePath: string;
}

/** Strip markdown syntax for terminal rendering — keep text readable. */
function renderLine(line: string): {
  text: string;
  bold: boolean;
  dimmed: boolean;
} {
  if (/^#{1,3}\s/.test(line)) {
    return { text: line.replace(/^#+\s*/, ''), bold: true, dimmed: false };
  }
  if (/^---+$/.test(line.trim())) {
    return { text: '─'.repeat(40), bold: false, dimmed: true };
  }
  return { text: line, bold: false, dimmed: false };
}

export const ReportViewer = ({ filePath }: ReportViewerProps) => {
  const [, rows] = useStdoutDimensions();
  const visibleLines = Math.max(5, rows - CHROME_ROWS);

  const [lines, setLines] = useState<string[]>([]);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      setLines(content.split('\n'));
    } catch {
      setLines(['(No report found — the agent may still be running)']);
    }

    // Watch for the file to appear/update (agent may still be writing)
    let watcher: fs.FSWatcher | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;

    const startWatch = () => {
      try {
        watcher = fs.watch(filePath, () => {
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            setLines(content.split('\n'));
          } catch {
            // ignore
          }
        });
      } catch {
        // File not yet available — poll
        interval = setInterval(() => {
          try {
            fs.accessSync(filePath);
            const content = fs.readFileSync(filePath, 'utf-8');
            setLines(content.split('\n'));
            clearInterval(interval);
            interval = undefined;
            startWatch();
          } catch {
            // still waiting
          }
        }, 1000);
      }
    };

    startWatch();

    return () => {
      watcher?.close();
      if (interval) clearInterval(interval);
    };
  }, [filePath]);

  const maxOffset = Math.max(0, lines.length - visibleLines);

  useScreenInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setOffset((o) => Math.max(0, o - 1));
    } else if (key.downArrow || input === 'j') {
      setOffset((o) => Math.min(maxOffset, o + 1));
    } else if (key.pageUp) {
      setOffset((o) => Math.max(0, o - visibleLines));
    } else if (key.pageDown) {
      setOffset((o) => Math.min(maxOffset, o + visibleLines));
    }
  });

  const visible = lines.slice(offset, offset + visibleLines);

  return (
    <Box flexDirection="column" height={visibleLines}>
      {visible.map((line, i) => {
        const { text, bold, dimmed } = renderLine(line);
        return (
          <Text
            key={i}
            bold={bold}
            color={dimmed ? Colors.muted : undefined}
            wrap="truncate"
          >
            {text}
          </Text>
        );
      })}
      {lines.length > visibleLines && (
        <Text color={Colors.muted}>
          {' '}
          ↑↓ to scroll · {offset + visibleLines}/{lines.length} lines
        </Text>
      )}
    </Box>
  );
};
