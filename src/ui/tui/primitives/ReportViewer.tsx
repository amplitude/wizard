/**
 * ReportViewer — Scrollable viewer for amplitude-setup-report.md.
 *
 * Reads the file from disk and renders it with full markdown support
 * (headings, code blocks, tables, lists, emphasis) via marked-terminal.
 * Supports up/down scrolling via arrow keys or j/k vim keys.
 */

import { Box, Text } from 'ink';
import { useState, useEffect, useRef } from 'react';
import * as fs from 'fs';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { Colors } from '../styles.js';
import { renderMarkdown } from '../utils/terminal-rendering.js';
import { watchFileWhenAvailable } from '../utils/watchFileWhenAvailable.js';

/** Rows consumed by ConsoleView border + TitleBar + separator + tab bar chrome */
const CHROME_ROWS = 10;

/** ANSI SGR reset — closes bold/color/background. */
const ANSI_RESET = '\x1b[0m';

interface ReportViewerProps {
  filePath: string;
}

export const ReportViewer = ({ filePath }: ReportViewerProps) => {
  const [, rows] = useStdoutDimensions();
  const visibleLines = Math.max(5, rows - CHROME_ROWS);

  const [lines, setLines] = useState<string[]>([]);
  const [offset, setOffset] = useState(0);
  const prevRawRef = useRef<string>('');

  useEffect(() => {
    const updateContent = () => {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        if (raw === prevRawRef.current) return; // skip redundant re-renders
        prevRawRef.current = raw;
        const rendered = renderMarkdown(raw);
        // marked-terminal wraps long headings/code blocks across multiple
        // lines but only emits the closing reset at the end of the block.
        // When we split on \n and render each line in its own <Text>, any
        // line whose color span continues onto the next line leaks its
        // open-color into the rest of the terminal — which is what caused
        // the entire screen to turn lilac/pink after viewing the setup
        // report. Append a hard reset to each line so styling cannot bleed
        // past line boundaries even if the source rendering forgets to
        // close itself.
        setLines(rendered.split('\n').map((l) => l + ANSI_RESET));
      } catch {
        setLines(['(No report found — the agent may still be running)']);
      }
    };

    updateContent();

    // Single-owner watcher that closes the swap race between the poll
    // interval and the fs.watch handle. See `watchFileWhenAvailable`
    // for the race details. Replaced two-variable closure cleanup
    // (watcher + interval) with one `dispose()`.
    const handle = watchFileWhenAvailable({
      filePath,
      onChange: updateContent,
    });

    return () => handle.dispose();
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
      {visible.map((line, i) => (
        <Text key={i} wrap="truncate">
          {line}
        </Text>
      ))}
      {lines.length > visibleLines && (
        <Text color={Colors.muted}>
          {' '}
          ↑↓ to scroll · {offset + visibleLines}/{lines.length} lines
        </Text>
      )}
    </Box>
  );
};
