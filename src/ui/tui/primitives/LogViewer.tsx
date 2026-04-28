/**
 * LogViewer — real-time log viewer with two modes:
 * - Follow: stays pinned to the live tail
 * - Inspect: freezes the viewport for vertical/horizontal scrolling
 *
 * Error entries are indexed so users can jump through failures even while
 * new output continues arriving in the file.
 */

import { Box, Text } from 'ink';
import { Colors } from '../styles.js';
import { useState, useEffect, useMemo, useRef } from 'react';
import * as fs from 'fs';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';
import { linkify } from '../utils/terminal-rendering.js';
import { useScreenInput } from '../hooks/useScreenInput.js';
import {
  buildLogLineMeta,
  clamp,
  clampViewportTop,
  findErrorEntryIndexes,
  sliceViewportText,
} from '../utils/log-viewer.js';

/** Rows consumed by ConsoleView border + TitleBar + spacer + separator + input + tab bar chrome */
const CHROME_ROWS = 8;
const VIEWER_CHROME_ROWS = 4;
const HORIZONTAL_STEP = 8;

/**
 * Placeholder shown when the log file can't be read. Used both for "doesn't
 * exist yet" (early in a run, before the agent has flushed anything) and
 * "transient read error" cases. The previous copy was a flat
 * "(No log file found)" which gave users no path forward — they'd see it
 * during normal run startup and assume the wizard was broken. New copy:
 *  - explains the file is created lazily by the agent
 *  - tells them what to do (wait, or check the path)
 *  - shows the resolved path so a hardcoded-vs-configured mismatch is
 *    immediately visible
 *
 * Keep it to 3 lines so the existing "line N/N" status copy stays sensible.
 */
const EMPTY_LOG_PLACEHOLDER = 'Waiting for the agent to start writing logs…';

interface LogViewerProps {
  filePath: string;
  /** Fixed visible height. Defaults to terminal rows minus chrome. */
  height?: number;
}

export const LogViewer = ({ filePath, height }: LogViewerProps) => {
  const [cols, rows] = useStdoutDimensions();
  const visibleLines = height ?? Math.max(8, rows - CHROME_ROWS);
  const viewportHeight = Math.max(3, visibleLines - VIEWER_CHROME_ROWS);

  const [lines, setLines] = useState<string[]>([]);
  const [mode, setMode] = useState<'follow' | 'inspect'>('follow');
  const [selectedLine, setSelectedLine] = useState(0);
  const [viewportTop, setViewportTop] = useState(0);
  const [horizontalOffset, setHorizontalOffset] = useState(0);

  const modeRef = useRef(mode);
  const selectedLineRef = useRef(selectedLine);
  const viewportTopRef = useRef(viewportTop);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    selectedLineRef.current = selectedLine;
  }, [selectedLine]);

  useEffect(() => {
    viewportTopRef.current = viewportTop;
  }, [viewportTop]);

  const meta = useMemo(() => buildLogLineMeta(lines), [lines]);
  const errorIndexes = useMemo(() => findErrorEntryIndexes(meta), [meta]);
  const selectedMeta = meta[selectedLine];
  const digits = Math.max(2, String(Math.max(lines.length, 1)).length);
  const gutterWidth = digits + 3;
  const lineWidth = Math.max(10, cols - gutterWidth - 2);

  const alignViewportToSelection = (nextSelectedLine: number) => {
    const minTop = nextSelectedLine - (viewportHeight - 1);
    const maxTop = nextSelectedLine;
    const nextTop = clamp(viewportTopRef.current, minTop, maxTop);
    setViewportTop(clampViewportTop(nextTop, lines.length, viewportHeight));
  };

  const enterInspectMode = () => {
    if (modeRef.current === 'follow') {
      setMode('inspect');
    }
  };

  const jumpToLine = (index: number) => {
    const nextIndex = clamp(index, 0, Math.max(lines.length - 1, 0));
    setSelectedLine(nextIndex);
    if (modeRef.current === 'follow') {
      setMode('inspect');
    }
    const minTop = nextIndex - (viewportHeight - 1);
    const maxTop = nextIndex;
    const nextTop = clamp(viewportTopRef.current, minTop, maxTop);
    setViewportTop(clampViewportTop(nextTop, lines.length, viewportHeight));
    const currentLine = lines[nextIndex] ?? '';
    const maxHorizontalOffset = Math.max(0, currentLine.length - lineWidth);
    setHorizontalOffset((prev) => clamp(prev, 0, maxHorizontalOffset));
  };

  const jumpToError = (direction: 1 | -1) => {
    if (errorIndexes.length === 0) return;

    const currentIndex = selectedLineRef.current;
    const nextErrorIndex =
      direction > 0
        ? errorIndexes.find((index) => index > currentIndex) ?? errorIndexes[0]
        : [...errorIndexes].reverse().find((index) => index < currentIndex) ??
          errorIndexes[errorIndexes.length - 1];

    jumpToLine(nextErrorIndex);
  };

  useEffect(() => {
    const readTail = () => {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const allLines = content.split('\n');
        const safeLines =
          allLines.length > 0 ? allLines : [EMPTY_LOG_PLACEHOLDER];
        const nextLastIndex = Math.max(safeLines.length - 1, 0);
        const nextViewportTop = clampViewportTop(
          viewportTopRef.current,
          safeLines.length,
          viewportHeight,
        );
        setLines(safeLines);

        if (modeRef.current === 'follow') {
          setSelectedLine(nextLastIndex);
          setHorizontalOffset(0);
          setViewportTop(
            clampViewportTop(
              safeLines.length - viewportHeight,
              safeLines.length,
              viewportHeight,
            ),
          );
        } else {
          const nextSelectedLine = clamp(
            selectedLineRef.current,
            0,
            nextLastIndex,
          );
          setSelectedLine(nextSelectedLine);
          setViewportTop(nextViewportTop);
          const currentLine = safeLines[nextSelectedLine] ?? '';
          const maxHorizontalOffset = Math.max(
            0,
            currentLine.length - lineWidth,
          );
          setHorizontalOffset((prev) => clamp(prev, 0, maxHorizontalOffset));
        }
      } catch {
        // Show the resolved path right under the placeholder so a
        // hardcoded-vs-configured mismatch (e.g. AMPLITUDE_WIZARD_LOG
        // pointing at a different file than the viewer is reading from)
        // is immediately visible to the user. Without the path, users
        // see "no log file found" with no way to debug.
        setLines([
          EMPTY_LOG_PLACEHOLDER,
          '',
          `path: ${filePath}`,
          '(file is created the first time the agent flushes a log line)',
        ]);
        setSelectedLine(0);
        setViewportTop(0);
        setHorizontalOffset(0);
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
  }, [filePath, viewportHeight, lineWidth]);

  useEffect(() => {
    if (mode !== 'follow') {
      alignViewportToSelection(selectedLine);
    }
  }, [viewportHeight]);

  useScreenInput((input, key) => {
    if (key.upArrow || input === 'k') {
      enterInspectMode();
      jumpToLine(selectedLineRef.current - 1);
      return;
    }

    if (key.downArrow || input === 'j') {
      enterInspectMode();
      jumpToLine(selectedLineRef.current + 1);
      return;
    }

    if (input === 'h') {
      enterInspectMode();
      setHorizontalOffset((prev) => Math.max(0, prev - HORIZONTAL_STEP));
      return;
    }

    if (input === 'l') {
      enterInspectMode();
      const currentLine = lines[selectedLineRef.current] ?? '';
      const maxHorizontalOffset = Math.max(0, currentLine.length - lineWidth);
      setHorizontalOffset((prev) =>
        Math.min(maxHorizontalOffset, prev + HORIZONTAL_STEP),
      );
      return;
    }

    if (input === 'f') {
      if (modeRef.current === 'follow') {
        setMode('inspect');
      } else {
        setMode('follow');
        setSelectedLine(Math.max(lines.length - 1, 0));
        setHorizontalOffset(0);
        setViewportTop(
          clampViewportTop(
            lines.length - viewportHeight,
            lines.length,
            viewportHeight,
          ),
        );
      }
      return;
    }

    if (input === '0') {
      // Full reset back to a known-good state: follow mode, latest line,
      // col 1. The previous behavior only zeroed horizontalOffset, which
      // was a no-op in the very-common case where horizontalOffset was
      // already 0 (e.g. "(No log file found)" / short logs / no panning
      // done yet). Users hit `0` expecting it to do something — anything
      // — and got silence. "Reset" should mean "get me back to the
      // default view," and the default for a tail viewer is following
      // the live tail at column 1.
      setMode('follow');
      setHorizontalOffset(0);
      const lastIndex = Math.max(lines.length - 1, 0);
      setSelectedLine(lastIndex);
      setViewportTop(
        clampViewportTop(
          lines.length - viewportHeight,
          lines.length,
          viewportHeight,
        ),
      );
      return;
    }

    if (input === 'g') {
      enterInspectMode();
      jumpToLine(0);
      return;
    }

    if (input === 'G') {
      enterInspectMode();
      jumpToLine(lines.length - 1);
      return;
    }

    if (input === 'n') {
      jumpToError(1);
      return;
    }

    if (input === 'p') {
      jumpToError(-1);
    }
  });

  const visibleRows = lines.slice(viewportTop, viewportTop + viewportHeight);
  const selectedLineText = lines[selectedLine] ?? EMPTY_LOG_PLACEHOLDER;
  const selectedErrorOrdinal =
    selectedMeta?.entryKind === 'error'
      ? errorIndexes.findIndex(
          (index) => index === selectedMeta.entryStartIndex,
        ) + 1
      : 0;
  const detailText = sliceViewportText(
    selectedLineText,
    horizontalOffset,
    Math.max(10, cols - 14),
  );
  const errorCount = errorIndexes.length;
  const errorStatus =
    errorCount === 0
      ? 'no errors'
      : selectedErrorOrdinal > 0
      ? `error ${selectedErrorOrdinal} of ${errorCount}`
      : `${errorCount} ${errorCount === 1 ? 'error' : 'errors'}`;

  return (
    <Box flexDirection="column" height={visibleLines} paddingX={1}>
      <Box justifyContent="space-between">
        <Text color={mode === 'follow' ? Colors.accent : Colors.warning} bold>
          {mode === 'follow' ? 'LIVE FOLLOW' : 'INSPECT'}
        </Text>
        <Text color={Colors.muted}>
          line {Math.min(selectedLine + 1, Math.max(lines.length, 1))}/
          {Math.max(lines.length, 1)} · col {horizontalOffset + 1} ·{' '}
          <Text color={errorCount > 0 ? Colors.warning : Colors.muted}>
            {errorStatus}
          </Text>
        </Text>
      </Box>

      <Box flexDirection="column" height={viewportHeight}>
        {visibleRows.map((line, rowIndex) => {
          const absoluteIndex = viewportTop + rowIndex;
          const lineMeta = meta[absoluteIndex];
          const isSelected = absoluteIndex === selectedLine;
          const marker =
            lineMeta?.entryKind === 'error' &&
            lineMeta.entryStartIndex === absoluteIndex
              ? '!'
              : isSelected
              ? '›'
              : ' ';
          const gutter = `${marker} ${String(absoluteIndex + 1).padStart(
            digits,
            ' ',
          )} `;
          const visibleText = sliceViewportText(
            line,
            horizontalOffset,
            lineWidth,
          );

          return (
            <Text
              key={absoluteIndex}
              color={
                isSelected ? Colors.heading : lineMeta?.color ?? Colors.muted
              }
              wrap="truncate-end"
            >
              <Text color={isSelected ? Colors.accent : Colors.subtle}>
                {gutter}
              </Text>
              {linkify(visibleText)}
            </Text>
          );
        })}
      </Box>

      <Text color={Colors.secondary} wrap="truncate-end">
        <Text bold color={Colors.accent}>
          Selected:
        </Text>{' '}
        {linkify(detailText || '(blank line)')}
      </Text>

      <Text color={Colors.muted} wrap="truncate-end">
        ↑↓/jk scroll · h/l pan · ←→ tabs · f follow ·{' '}
        {errorCount > 0 ? 'n/p next/prev error · ' : ''}g/G top/bottom · 0 reset
      </Text>

      <Text color={Colors.subtle} wrap="truncate-end">
        New logs keep appending in inspect mode; `f` jumps back to the live
        tail.
      </Text>
    </Box>
  );
};
