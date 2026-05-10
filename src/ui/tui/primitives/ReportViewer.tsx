/**
 * ReportViewer — Scrollable viewer for amplitude-setup-report.md.
 *
 * Reads the file from disk and renders it with full markdown support
 * (headings, code blocks, tables, lists, emphasis) via marked-terminal.
 *
 * Navigation contract (mirrors LogViewer for muscle-memory parity):
 *   - ↑↓ / j k        scroll one line vertically
 *   - PgUp / PgDn     scroll one viewport vertically
 *   - h l / ← →       pan one HORIZONTAL_STEP horizontally
 *   - g / G           jump to top / bottom
 *   - 0               reset vertical + horizontal offsets
 *   - q / Esc         close (handled by the parent OutroScreen)
 *
 * Lines that are wider than the content area no longer get clipped with
 * a stray `…`; instead the user pans horizontally to read them in full.
 * That matters for the events table inside the Setup Report — whose
 * rows can easily exceed the terminal column width — and for any
 * fenced code blocks containing long file paths or JSON payloads.
 */

import { Box, Text } from 'ink';
import { useState, useEffect, useRef, useMemo } from 'react';
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

/**
 * Horizontal pan increment, in visible columns. Matches `LogViewer`'s
 * `HORIZONTAL_STEP` so users moving between the Logs tab and the Setup
 * Report sub-view get the same per-keystroke jump distance.
 */
const HORIZONTAL_STEP = 8;

/**
 * Match a single ANSI control sequence emitted by `marked-terminal` /
 * `chalk`. Two flavours we care about preserving across slicing:
 *  - SGR (color/bold/etc.):     `\x1b[…m`
 *  - OSC hyperlink open/close:  `\x1b]8;…\x07` (terminator is BEL)
 *
 * The regex is anchored to the start of whatever we're inspecting; we
 * advance the cursor by the matched length when a sequence is found.
 *
 * eslint-disable-next-line no-control-regex — ANSI requires control bytes.
 */
// eslint-disable-next-line no-control-regex
const ANSI_AT_CURSOR = /^(?:\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07)/;

/**
 * Slice a single line of (possibly ANSI-coloured) text to a horizontal
 * window `[panOffset, panOffset + width)` of *visible* columns.
 *
 * Plain `string.slice(panOffset, panOffset + width)` would corrupt the
 * line: ANSI escapes (`\x1b[31m`, OSC hyperlinks, etc.) don't occupy
 * visible columns but they DO occupy string indexes, so a naive slice
 * would split colors mid-byte and either drop the open code (text
 * renders uncoloured) or drop the reset (color leaks past the slice).
 *
 * Walk the string char-by-char, copying every ANSI escape we encounter
 * (regardless of whether we're inside the visible window) and copying
 * visible characters only when their column index falls in
 * `[panOffset, panOffset + width)`. Append `\x1b[0m` at the end so any
 * still-open SGR state is closed at the slice boundary — same belt-and-
 * suspenders trick the render path already uses on line termination.
 */
export function sliceAnsiHorizontal(
  line: string,
  panOffset: number,
  width: number,
): string {
  if (width <= 0) return '';
  let visibleCol = 0;
  let i = 0;
  let out = '';
  const end = panOffset + width;
  while (i < line.length) {
    const tail = line.slice(i);
    const escMatch = ANSI_AT_CURSOR.exec(tail);
    if (escMatch) {
      // Always preserve escapes. Dropping them would un-color the slice
      // (or worse, leak open codes past the line boundary).
      out += escMatch[0];
      i += escMatch[0].length;
      continue;
    }
    if (visibleCol >= end) break;
    if (visibleCol >= panOffset) {
      out += line[i];
    }
    visibleCol += 1;
    i += 1;
  }
  return out + ANSI_RESET;
}

/**
 * Visible-column length of a line, ignoring ANSI escape sequences. Used
 * to compute the maximum horizontal pan offset so users can't scroll
 * past the rightmost real character into empty space.
 */
export function visibleLength(line: string): number {
  let visible = 0;
  let i = 0;
  while (i < line.length) {
    const tail = line.slice(i);
    const escMatch = ANSI_AT_CURSOR.exec(tail);
    if (escMatch) {
      i += escMatch[0].length;
      continue;
    }
    visible += 1;
    i += 1;
  }
  return visible;
}

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
  // Reserve one row for the key-hint footer so it always sits on the
  // last line of the viewer rather than getting pushed off-screen.
  const totalRows = Math.max(5, baseRows - siblingRows);
  const visibleLines = Math.max(3, totalRows - 1);

  const [lines, setLines] = useState<string[]>([]);
  const [offset, setOffset] = useState(0);
  const [panOffset, setPanOffset] = useState(0);
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

  const maxOffset = Math.max(0, lines.length - visibleLines);

  // Widest line in the document, in visible columns. Used to clamp the
  // horizontal pan so users can't scroll into empty whitespace past the
  // longest line. Memoized because `visibleLength` is O(n) per line.
  const longestLineWidth = useMemo(() => {
    let max = 0;
    for (const line of lines) {
      const w = visibleLength(line);
      if (w > max) max = w;
    }
    return max;
  }, [lines]);

  const maxPanOffset = Math.max(0, longestLineWidth - cols);

  useScreenInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setOffset((o) => Math.max(0, o - 1));
      return;
    }
    if (key.downArrow || input === 'j') {
      setOffset((o) => Math.min(maxOffset, o + 1));
      return;
    }
    if (key.pageUp) {
      setOffset((o) => Math.max(0, o - visibleLines));
      return;
    }
    if (key.pageDown) {
      setOffset((o) => Math.min(maxOffset, o + visibleLines));
      return;
    }
    if (key.leftArrow || input === 'h') {
      setPanOffset((p) => Math.max(0, p - HORIZONTAL_STEP));
      return;
    }
    if (key.rightArrow || input === 'l') {
      setPanOffset((p) => Math.min(maxPanOffset, p + HORIZONTAL_STEP));
      return;
    }
    if (input === 'g') {
      setOffset(0);
      return;
    }
    if (input === 'G') {
      setOffset(maxOffset);
      return;
    }
    if (input === '0') {
      // Match LogViewer's "reset to a known-good state" semantics: snap
      // both axes back to the origin so the user sees the start of the
      // report at column 1 regardless of where they panned to.
      setOffset(0);
      setPanOffset(0);
      return;
    }
  });

  const visible = lines.slice(offset, offset + visibleLines);
  const showVerticalProgress = lines.length > visibleLines;
  const showHorizontalProgress = maxPanOffset > 0;

  return (
    <Box flexDirection="column" height={totalRows}>
      <Box flexDirection="column" height={visibleLines}>
        {visible.map((line, i) => (
          // `wrap="truncate-end"` was the old behaviour and silently
          // clipped any line wider than the content area — every events-
          // table row picked up a stray "…" decoration. With pan-aware
          // slicing the line is already exactly `cols` visible columns
          // wide, so the wrap mode is moot, but we keep it as a safety
          // net for the very-rare case where ANSI math undercounts.
          <Text key={i} wrap="truncate-end">
            {sliceAnsiHorizontal(line, panOffset, cols)}
          </Text>
        ))}
      </Box>
      <Text color={Colors.muted} wrap="truncate-end">
        ↑↓/jk scroll · h/l pan · g/G top/bottom · 0 reset · Esc close
        {showVerticalProgress
          ? ` · line ${Math.min(offset + visibleLines, lines.length)}/${
              lines.length
            }`
          : ''}
        {showHorizontalProgress ? ` · col ${panOffset + 1}` : ''}
      </Text>
    </Box>
  );
};
