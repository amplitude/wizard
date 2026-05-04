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
  findSessionStartIndex,
  sliceViewportText,
} from '../utils/log-viewer.js';
import { watchFileWhenAvailable } from '../utils/watchFileWhenAvailable.js';

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

/** Shown when the file has older runs but nothing timestamped for this session yet. */
function scopedEmptyPlaceholder(hiddenLines: number): string[] {
  const n = hiddenLines;
  const linesWord = n === 1 ? 'line' : 'lines';
  return [
    'No log lines from this session yet.',
    `${n} earlier ${linesWord} from prior runs are above the session cut.`,
    'Press `a` to show full history, or keep waiting — new lines append here.',
  ];
}

interface LogViewerProps {
  filePath: string;
  /** Fixed visible height. Defaults to terminal rows minus chrome. */
  height?: number;
  /**
   * Epoch-ms when the current wizard session started. When set, the live
   * tail is scoped to lines whose timestamp is `>= sessionStartMs` so
   * users don't see prior sessions' tails (the `log.txt` file is
   * append-only across runs). Press `a` in the viewer to toggle the
   * filter off and show the full file. Pass `null` (or omit) to disable
   * scoping entirely — useful for `--debug` or when the user explicitly
   * wants the full historical log.
   */
  sessionStartMs?: number | null;
}

export const LogViewer = ({
  filePath,
  height,
  sessionStartMs = null,
}: LogViewerProps) => {
  const [cols, rows] = useStdoutDimensions();
  const visibleLines = height ?? Math.max(8, rows - CHROME_ROWS);
  const viewportHeight = Math.max(3, visibleLines - VIEWER_CHROME_ROWS);

  const [lines, setLines] = useState<string[]>([]);
  const [mode, setMode] = useState<'follow' | 'inspect'>('follow');
  const [selectedLine, setSelectedLine] = useState(0);
  const [viewportTop, setViewportTop] = useState(0);
  const [horizontalOffset, setHorizontalOffset] = useState(0);
  /**
   * When false, scope the visible tail to the current wizard session
   * (lines newer than `sessionStartMs`). Press `a` to toggle off and see
   * the full historical file. Defaults to scoped (false=show-all is opt-in)
   * when `sessionStartMs` is provided; when it's null, scoping is a no-op.
   */
  const [showAll, setShowAll] = useState(false);
  /**
   * Count of lines hidden by the session-scoping filter. Surfaced in the
   * header so users know there's history available behind the `a` toggle.
   */
  const [hiddenCount, setHiddenCount] = useState(0);

  const modeRef = useRef(mode);
  const selectedLineRef = useRef(selectedLine);
  const viewportTopRef = useRef(viewportTop);
  const showAllRef = useRef(showAll);

  useEffect(() => {
    showAllRef.current = showAll;
  }, [showAll]);

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
        // Scope to the current wizard session unless the user opted into
        // "show all" with `a`. The historical tail above today's session
        // is still on disk — toggle reveals it without re-reading.
        const startIdx =
          sessionStartMs !== null && !showAllRef.current
            ? findSessionStartIndex(allLines, sessionStartMs)
            : 0;
        const scopedLines = startIdx > 0 ? allLines.slice(startIdx) : allLines;
        setHiddenCount(startIdx);
        const hasReadableContent = allLines.some((l) => l.trim().length > 0);
        const safeLines =
          scopedLines.length > 0
            ? scopedLines
            : startIdx > 0 && hasReadableContent
              ? scopedEmptyPlaceholder(startIdx)
              : [EMPTY_LOG_PLACEHOLDER];
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

    // Single-owner watcher that closes the swap race between the poll
    // interval and the fs.watch handle. See `watchFileWhenAvailable`
    // for the race details. Replaced two-variable closure cleanup
    // (watcher + interval) with one `dispose()`.
    const handle = watchFileWhenAvailable({
      filePath,
      onChange: readTail,
    });

    return () => handle.dispose();
  }, [filePath, viewportHeight, lineWidth, sessionStartMs, showAll]);

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
      return;
    }

    if (input === 'a' && sessionStartMs !== null) {
      // Toggle session-scoping. Drop back to follow mode + tail-bottom so
      // the user lands on the most-recent entry whichever scope is now
      // active — otherwise toggling while scrolled feels like jumping to
      // a random offset.
      setShowAll((prev) => !prev);
      setMode('follow');
      setHorizontalOffset(0);
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
          {sessionStartMs !== null && !showAll && hiddenCount > 0 ? (
            <Text color={Colors.muted} bold={false}>
              {' '}
              · this session
            </Text>
          ) : null}
          {showAll ? (
            <Text color={Colors.muted} bold={false}>
              {' '}
              · all history
            </Text>
          ) : null}
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
        {sessionStartMs !== null
          ? ` · a ${showAll ? 'this session' : 'show all'}`
          : ''}
      </Text>

      <Text color={Colors.subtle} wrap="truncate-end">
        New logs keep appending in inspect mode; `f` jumps back to the live
        tail.
      </Text>
    </Box>
  );
};
