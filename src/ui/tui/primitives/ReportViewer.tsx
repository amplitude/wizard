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
import { useContentArea } from '../context/ContentAreaContext.js';
import { Colors } from '../styles.js';
import { renderMarkdown } from '../utils/terminal-rendering.js';
import { watchFileWhenAvailable } from '../utils/watchFileWhenAvailable.js';

/**
 * Fallback rows consumed by ConsoleView border + TitleBar + separator +
 * tab bar chrome when no ContentAreaContext is available (e.g. unit
 * tests rendering ReportViewer in isolation). When the context is
 * present we use its `height` directly, which already accounts for App
 * chrome — and the caller can deduct any sibling chrome it adds via
 * `siblingRows` so the report doesn't overflow the viewport.
 */
const FALLBACK_CHROME_ROWS = 10;

/** ANSI SGR reset — closes bold/color/background. */
const ANSI_RESET = '\x1b[0m';

interface ReportViewerProps {
  filePath: string;
  /**
   * Rows consumed by sibling content rendered inside the same content
   * area (e.g. OutroScreen's own header, CTA, and key-hint footer).
   * Subtracted from the available content height so the scroll area
   * doesn't push the parent's footer off the bottom of the viewport —
   * Ink/Yoga defaults `flexShrink` to 0, so a fixed-height
   * `<Box height={…}>` won't compress to make room for siblings.
   */
  siblingRows?: number;
}

export const ReportViewer = ({
  filePath,
  siblingRows = 0,
}: ReportViewerProps) => {
  const [stdoutCols, stdoutRows] = useStdoutDimensions();
  const contentArea = useContentArea();
  // Prefer the content-area metrics when mounted inside the App tree.
  // The context width already deducts App.tsx's `paddingX` on both
  // sides; combined with `buildTerminalMarked`'s internal `-4`, the
  // total padding accounted for is 12 cols, which matches the actual
  // OutroScreen layout (App paddingX=4 ×2 + sub-view paddingX=2 ×2).
  const cols = contentArea?.width ?? stdoutCols;
  const baseRows = contentArea?.height ?? stdoutRows - FALLBACK_CHROME_ROWS;
  const visibleLines = Math.max(5, baseRows - siblingRows);

  const [lines, setLines] = useState<string[]>([]);
  const [offset, setOffset] = useState(0);
  const prevRawRef = useRef<string>('');
  // Cache the cols used for the last render so we know whether to
  // re-parse on resize. Re-parsing cost is dominated by `marked`,
  // which is fine for the rare resize event but wasteful on every
  // re-render (the picker re-mounts on each keypress).
  const prevColsRef = useRef<number>(0);

  useEffect(() => {
    const updateContent = () => {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        if (raw === prevRawRef.current && prevColsRef.current === cols) {
          return; // skip redundant re-renders
        }
        prevRawRef.current = raw;
        prevColsRef.current = cols;
        // Pass terminal width so cli-table3 sizes columns to fit the
        // viewport instead of overflowing past the right edge — without
        // this, every line of the Setup Report's events table got a
        // stray "…" decoration from `<Text wrap="truncate">` below.
        const rendered = renderMarkdown(raw, cols);
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
    // `cols` is included so a terminal resize re-parses the markdown
    // with the new viewport width. Without this dependency, the table
    // column widths would stay locked to the cols at first mount.
  }, [filePath, cols]);

  // Reserve one row inside the budget for the scroll indicator when
  // the report is taller than the viewport. Without this reserve, the
  // viewer rendered `visibleLines` body rows AND a scroll-hint row in a
  // Box with `height={visibleLines}` — total content was `visibleLines +
  // 1`, but the parent column reserved only `visibleLines` for the
  // viewer, so the scroll hint overflowed downward and overdrew the next
  // sibling (the `[O] Open in browser · [Esc] Back` strip in the
  // showReport view of OutroScreen, the FIRST-row events-table header on
  // a real terminal). See repro evidence in PR description.
  const willShowScrollHint = lines.length > visibleLines;
  const contentLines = willShowScrollHint
    ? Math.max(1, visibleLines - 1)
    : visibleLines;
  const maxOffset = Math.max(0, lines.length - contentLines);

  useScreenInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setOffset((o) => Math.max(0, o - 1));
    } else if (key.downArrow || input === 'j') {
      setOffset((o) => Math.min(maxOffset, o + 1));
    } else if (key.pageUp) {
      setOffset((o) => Math.max(0, o - contentLines));
    } else if (key.pageDown) {
      setOffset((o) => Math.min(maxOffset, o + contentLines));
    }
  });

  const visible = lines.slice(offset, offset + contentLines);

  // `overflow="hidden"` is a defense-in-depth guarantee: even if a
  // child Text rendered wider than the column expected (e.g. a long
  // table row that marked-terminal padded past `cols`), Yoga must clip
  // rather than spill into the next sibling's row.
  return (
    <Box flexDirection="column" height={visibleLines} overflow="hidden">
      {visible.map((line, i) => (
        <Text key={i} wrap="truncate">
          {line}
        </Text>
      ))}
      {willShowScrollHint && (
        <Text color={Colors.muted} wrap="truncate">
          {' '}
          ↑↓ to scroll · {offset + visible.length}/{lines.length} lines
        </Text>
      )}
    </Box>
  );
};
