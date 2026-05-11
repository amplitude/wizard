/**
 * PickerMenu — Single and multi select.
 * Single mode: custom renderer with small triangle indicator.
 * Multi mode: checkbox glyphs with space to toggle.
 *
 * Pagination uses Ink's `measureElement` to compute the actual rendered
 * header height, so chrome rows are derived from real layout (accounting
 * for PromptLabel text wrapping on narrow terminals) instead of a fixed
 * constant. The hardcoded constant is retained as a first-frame fallback.
 */

import { Box, Text, measureElement, type DOMElement } from 'ink';
import { useState, useRef, useEffect } from 'react';
import { Icons, Colors } from '../styles.js';
import { PromptLabel } from './PromptLabel.js';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';
import { logToFile } from '../../../utils/debug.js';

/**
 * First-frame fallback chrome size, used before `measureElement` has run.
 * After the initial layout pass we replace this with the measured header
 * height plus a small allowance for scroll indicators and bottom padding.
 */
const PICKER_CHROME_ROWS_FALLBACK = 16;

/**
 * Selection-confirmation flash duration (ms). When the user commits a
 * choice (Enter or a digit key) the selected row briefly flashes with
 * an accent background before the screen transitions away. This is the
 * "the input was received" feedback users expect from native menu UIs
 * and matches the wait time most operating-system menu pickers use.
 * Exported so tests can reference the same constant.
 */
export const PICKER_FLASH_MS = 250;

/** Minimum number of visible options on extremely short terminals. */
const MIN_VISIBLE_ROWS = 5;

/**
 * Reserve rows beyond the measured header for: optional "↑ N more" /
 * "↓ N more" indicators (up to 2) plus a one-row safety buffer for the
 * keyboard hint bar / cursor below the picker.
 */
const CHROME_FOOTER_RESERVE_ROWS = 3;

/**
 * When a parent passes an explicit row budget, reserve space for chrome
 * rendered outside the option list:
 *  - 1 row: PromptLabel header (always rendered, even with no message —
 *    it outputs a single space character so it occupies one row).
 *  - 2 rows: optional "↑ N more" / "↓ N more" scroll indicators above and
 *    below the visible window when the list is paginated.
 *
 * Without this reserve, total rendered height would be
 *   1 (header) + 2 (indicators) + (availableRows − 2) options = availableRows + 1
 * and the parent's `overflow="hidden"` would clip the bottom indicator.
 */
const CONSTRAINED_CHROME_RESERVE_ROWS = 3;

/**
 * Pure helper — translate total rows + reserved chrome rows into the
 * number of option rows that fit. Extracted for unit testing.
 */
export function computeVisibleCount(
  totalRows: number,
  totalOptionRows: number,
  chromeRows: number,
): number {
  const available = totalRows - chromeRows;
  const fits = Math.max(MIN_VISIBLE_ROWS, available);
  return Math.min(totalOptionRows, fits);
}

interface PickerOption<T> {
  label: string;
  value: T;
  hint?: string;
}

interface PickerMenuProps<T> {
  message?: string;
  options: PickerOption<T>[];
  mode?: 'single' | 'multi';
  centered?: boolean;
  columns?: 1 | 2 | 3 | 4;
  /**
   * Rows available for the option list inside a constrained parent region.
   * Currently honoured only by single-mode pickers — multi-mode does not
   * paginate, so this prop is ignored when `mode === 'multi'`.
   */
  availableRows?: number;
  /** In multi mode, values to start selected. Ignored in single mode. */
  defaultSelected?: T[];
  onSelect: (value: T | T[]) => void;
}

export const PickerMenu = <T,>({
  message,
  options,
  mode = 'single',
  centered = false,
  columns = 1,
  availableRows,
  defaultSelected,
  onSelect,
}: PickerMenuProps<T>) => {
  if (mode === 'multi') {
    return (
      <MultiPickerMenu
        message={message}
        options={options}
        centered={centered}
        columns={columns}
        defaultSelected={defaultSelected}
        onSelect={onSelect}
      />
    );
  }

  return (
    <SinglePickerMenu
      message={message}
      options={options}
      centered={centered}
      columns={columns}
      availableRows={availableRows}
      onSelect={onSelect}
    />
  );
};

/** Returns the number key label for an option index (1-based, 0 = tenth). */
function numKey(index: number): string | null {
  if (index === 9) return '0';
  if (index < 9) return String(index + 1);
  return null;
}

/**
 * Threshold beyond which the digit-shortcut UI hints (the `[N]` chip per
 * row, and the implied "press a number to pick") are dropped. There are
 * only 10 digit shortcuts (1-9 plus 0 → index 9), so a list with more
 * than 10 options has items that look identical to shortcut-enabled
 * rows but don't respond to their visible number. Rather than render a
 * confusing partial set, hide the chips on every row once the list
 * exceeds the budget. The digit handler itself still works for indices
 * 0-9 (back-compat for power users), it just isn't advertised.
 */
const DIGIT_SHORTCUT_LIMIT = 10;

/** Render a single picker item row. */
const PickerItem = <T,>({
  opt,
  isFocused,
  isFlashing,
  index,
  showDigit,
}: {
  opt: PickerOption<T>;
  isFocused: boolean;
  /**
   * True for the brief window between the user committing a choice and
   * `onSelect` being invoked. Renders the row with an accent
   * background so the keystroke registers visibly — same affordance
   * native menu UIs use to acknowledge a click.
   */
  isFlashing?: boolean;
  index: number;
  /**
   * Whether to render the `[N]` digit-shortcut chip. Suppressed when
   * the parent picker has more than `DIGIT_SHORTCUT_LIMIT` options,
   * since the shortcut only covers the first 10 indices.
   */
  showDigit: boolean;
}) => {
  const label = opt.hint ? `${opt.label} (${opt.hint})` : opt.label;
  const key = showDigit ? numKey(index) : null;
  // Foreground rule: flashing rows render in white text against the
  // accent background so the row stays legible. Focused rows keep the
  // existing accent foreground on the default background; non-focused
  // rows stay muted. Picking these tiers separately avoids the
  // "accent-on-accent" invisible-text bug.
  const textColor = isFlashing
    ? Colors.heading
    : isFocused
    ? Colors.accent
    : Colors.muted;
  const bgColor = isFlashing ? Colors.accent : undefined;
  return (
    <Box gap={1}>
      <Text color={textColor} backgroundColor={bgColor}>
        {isFocused || isFlashing ? Icons.triangleSmallRight : ' '}
      </Text>
      {key !== null && (
        <Text color={textColor} backgroundColor={bgColor}>
          [{key}]
        </Text>
      )}
      <Text
        color={textColor}
        backgroundColor={bgColor}
        bold={isFocused || isFlashing}
      >
        {label}
      </Text>
    </Box>
  );
};

/** Custom single-select with triangle indicator and accent highlight.
 *  Single-column lists that exceed the terminal height scroll automatically. */
const SinglePickerMenu = <T,>({
  message,
  options,
  centered = false,
  columns = 1,
  availableRows,
  onSelect,
}: {
  message?: string;
  options: PickerOption<T>[];
  centered?: boolean;
  columns?: number;
  availableRows?: number;
  onSelect: (value: T | T[]) => void;
}) => {
  const [focused, setFocused] = useState(0);
  // Selection-confirmation flash. Holds the index the user just
  // committed (Enter / digit shortcut) so the row renders with an
  // accent background for PICKER_FLASH_MS before we hand control to
  // `onSelect`. Clearing the state via a return-cleanup on the effect
  // covers the "user unmounts the picker before the timer fires" case
  // (e.g. dispatcher navigates away). `setTimeout` IDs are stable so
  // we cancel-on-unmount; without that, a stale timer could call
  // `onSelect` after the parent has already moved on.
  const [flashingIndex, setFlashingIndex] = useState<number | null>(null);
  // Track if we're already flashing so a double-press (digit then
  // Enter) doesn't queue two onSelect calls — the timer captured the
  // intent on the first key.
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== null) {
        clearTimeout(flashTimerRef.current);
        flashTimerRef.current = null;
      }
    };
  }, []);
  const commitSelection = (idx: number, value: T): void => {
    if (flashTimerRef.current !== null) return;
    setFlashingIndex(idx);
    flashTimerRef.current = setTimeout(() => {
      flashTimerRef.current = null;
      // Always release the flash + input lock, even if `onSelect`
      // throws or the parent's navigation is asynchronous. Without
      // this guard, a thrown handler would leave `flashingIndex`
      // set — the input handler reads that as "still flashing" and
      // swallows every subsequent keystroke, deadlocking the picker
      // with no recovery path. Catch + re-throw asynchronously: the
      // error still surfaces (via Node's unhandled-rejection handler
      // and our existing error boundary) but the picker stays alive.
      try {
        onSelect(value);
      } catch (err) {
        // The picker's contract is "I won't deadlock". The parent's
        // contract is "your onSelect is safe to call". If the parent
        // breaks its contract, log to the wizard's debug file but
        // keep the picker responsive — silently swallowing here is
        // the lesser of two evils vs. the user being unable to type.
        logToFile(
          `PickerMenu onSelect threw — input released to avoid deadlock: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      } finally {
        setFlashingIndex(null);
      }
    }, PICKER_FLASH_MS);
  };
  // Digit shortcuts only cover indices 0-9 (keys 1-9 + 0). For larger
  // lists we hide both the per-row `[N]` chips and the implied digit
  // affordance so the UI doesn't lie about which rows respond. The
  // handler below still accepts digits for back-compat with users who
  // know the trick.
  const showDigits = options.length <= DIGIT_SHORTCUT_LIMIT;
  const [, termRows] = useStdoutDimensions();
  const scrollRef = useRef(0);
  const headerRef = useRef<DOMElement>(null);
  const [measuredHeader, setMeasuredHeader] = useState<number | null>(null);
  const rowsPerCol = Math.ceil(options.length / columns);
  const visibleRowsBudget =
    availableRows ?? Math.max(MIN_VISIBLE_ROWS, termRows);

  useEffect(() => {
    if (!headerRef.current) return;
    const { height } = measureElement(headerRef.current);
    if (height > 0 && height !== measuredHeader) {
      setMeasuredHeader(height);
    }
  });

  // When showDigits is false (options.length > DIGIT_SHORTCUT_LIMIT),
  // we render an extra "Use arrows + Enter to pick" hint row below
  // the option list. The constrained-mode chrome reserve must account
  // for it — otherwise the hint pushes total rendered height to
  // `availableRows + 1` and the parent's `overflow="hidden"` clips
  // the bottom indicator (or the hint itself).
  const hintRows = showDigits ? 0 : 1;
  const chromeRows =
    availableRows !== undefined
      ? CONSTRAINED_CHROME_RESERVE_ROWS + hintRows
      : measuredHeader !== null
      ? measuredHeader + CHROME_FOOTER_RESERVE_ROWS + hintRows
      : PICKER_CHROME_ROWS_FALLBACK + hintRows;
  const maxVisible =
    columns === 1
      ? computeVisibleCount(visibleRowsBudget, rowsPerCol, chromeRows)
      : rowsPerCol;
  const needsScroll = rowsPerCol > maxVisible;

  if (needsScroll) {
    if (focused < scrollRef.current) {
      scrollRef.current = focused;
    } else if (focused >= scrollRef.current + maxVisible) {
      scrollRef.current = focused - maxVisible + 1;
    }
  } else {
    scrollRef.current = 0;
  }
  const scrollOffset = scrollRef.current;

  useScreenInput((input, key) => {
    // Swallow all input while the flash window is open — the choice
    // is locked in, and we don't want a follow-up keypress to register
    // a second selection or scroll the list while the user sees the
    // confirmation flash.
    if (flashingIndex !== null) return;

    const col = Math.floor(focused / rowsPerCol);
    const row = focused % rowsPerCol;

    const digit = parseInt(input, 10);
    if (!isNaN(digit) && !key.ctrl && !key.meta) {
      const idx = digit === 0 ? 9 : digit - 1;
      const opt = options[idx];
      if (opt) {
        setFocused(idx);
        commitSelection(idx, opt.value);
        return;
      }
    }

    if (key.upArrow) {
      if (row > 0) {
        setFocused(col * rowsPerCol + row - 1);
      } else {
        setFocused(
          Math.min(col * rowsPerCol + rowsPerCol - 1, options.length - 1),
        );
      }
    }
    if (key.downArrow) {
      const next = col * rowsPerCol + row + 1;
      if (next < options.length && row + 1 < rowsPerCol) {
        setFocused(next);
      } else {
        setFocused(col * rowsPerCol);
      }
    }
    if (key.leftArrow && columns > 1) {
      const prevCol = col > 0 ? col - 1 : columns - 1;
      setFocused(Math.min(prevCol * rowsPerCol + row, options.length - 1));
    }
    if (key.rightArrow && columns > 1) {
      const nextCol = col < columns - 1 ? col + 1 : 0;
      setFocused(Math.min(nextCol * rowsPerCol + row, options.length - 1));
    }
    if (key.return) {
      const selected = options[focused];
      if (selected) {
        commitSelection(focused, selected.value);
      }
    }
  });

  const align = centered ? 'center' : undefined;

  if (needsScroll) {
    const hasAbove = scrollOffset > 0;
    const hasBelow = scrollOffset + maxVisible < options.length;
    const visible = options.slice(scrollOffset, scrollOffset + maxVisible);

    return (
      <Box flexDirection="column" alignItems={align}>
        <Box ref={headerRef} flexDirection="column">
          <PromptLabel message={message} />
        </Box>
        {hasAbove && (
          <Text color={Colors.muted}>
            {'  \u2191 '}
            {scrollOffset} more
          </Text>
        )}
        {visible.map((opt, i) => (
          <PickerItem
            key={scrollOffset + i}
            opt={opt}
            index={scrollOffset + i}
            isFocused={scrollOffset + i === focused}
            isFlashing={scrollOffset + i === flashingIndex}
            showDigit={showDigits}
          />
        ))}
        {hasBelow && (
          <Text color={Colors.muted}>
            {'  \u2193 '}
            {options.length - scrollOffset - maxVisible} more
          </Text>
        )}
        {!showDigits && (
          <Text color={Colors.muted}> Use arrows + Enter to pick</Text>
        )}
      </Box>
    );
  }

  const columnArrays: PickerOption<T>[][] = [];
  for (let c = 0; c < columns; c++) {
    columnArrays.push(
      options.slice(c * rowsPerCol, c * rowsPerCol + rowsPerCol),
    );
  }

  return (
    <Box flexDirection="column" alignItems={align}>
      <Box ref={headerRef} flexDirection="column">
        <PromptLabel message={message} />
      </Box>
      <Box flexDirection="row" gap={4}>
        {columnArrays.map((colOpts, colIdx) => (
          <Box key={colIdx} flexDirection="column">
            {colOpts.map((opt, rowIdx) => {
              const idx = colIdx * rowsPerCol + rowIdx;
              return (
                <PickerItem
                  key={idx}
                  opt={opt}
                  index={idx}
                  isFocused={idx === focused}
                  isFlashing={idx === flashingIndex}
                  showDigit={showDigits}
                />
              );
            })}
          </Box>
        ))}
      </Box>
      {!showDigits && (
        <Text color={Colors.muted}> Use arrows + Enter to pick</Text>
      )}
    </Box>
  );
};

/** Custom multi-select with checkbox glyphs and accent highlight. */
const MultiPickerMenu = <T,>({
  message,
  options,
  centered = false,
  columns = 1,
  defaultSelected,
  onSelect,
}: {
  message?: string;
  options: PickerOption<T>[];
  centered?: boolean;
  columns?: number;
  defaultSelected?: T[];
  onSelect: (value: T | T[]) => void;
}) => {
  const [focused, setFocused] = useState(0);
  // See SinglePickerMenu — digit chips are suppressed once the list
  // exceeds the 10-shortcut budget. The handler still accepts digits.
  const showDigits = options.length <= DIGIT_SHORTCUT_LIMIT;
  const [selected, setSelected] = useState<Set<number>>(() => {
    if (!defaultSelected?.length) return new Set();
    const initial = new Set<number>();
    options.forEach((opt, i) => {
      if (defaultSelected.includes(opt.value)) initial.add(i);
    });
    return initial;
  });
  const rows = Math.ceil(options.length / columns);

  useScreenInput((input, key) => {
    const col = Math.floor(focused / rows);
    const row = focused % rows;

    const digit = parseInt(input, 10);
    if (!isNaN(digit) && !key.ctrl && !key.meta) {
      const idx = digit === 0 ? 9 : digit - 1;
      if (idx < options.length) {
        setFocused(idx);
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(idx)) {
            next.delete(idx);
          } else {
            next.add(idx);
          }
          return next;
        });
      }
      return;
    }

    if (key.upArrow) {
      if (row > 0) {
        setFocused(col * rows + row - 1);
      } else {
        setFocused(Math.min(col * rows + rows - 1, options.length - 1));
      }
    }
    if (key.downArrow) {
      const next = col * rows + row + 1;
      if (next < options.length && row + 1 < rows) {
        setFocused(next);
      } else {
        setFocused(col * rows);
      }
    }
    if (key.leftArrow && columns > 1) {
      const prevCol = col > 0 ? col - 1 : columns - 1;
      setFocused(Math.min(prevCol * rows + row, options.length - 1));
    }
    if (key.rightArrow && columns > 1) {
      const nextCol = col < columns - 1 ? col + 1 : 0;
      setFocused(Math.min(nextCol * rows + row, options.length - 1));
    }
    if (input === ' ') {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(focused)) {
          next.delete(focused);
        } else {
          next.add(focused);
        }
        return next;
      });
    }
    if (key.return) {
      const values = [...selected]
        .sort((a, b) => a - b)
        .map((i) => options[i].value);
      if (values.length === 0 && !defaultSelected?.length) {
        const focusedOpt = options[focused];
        if (focusedOpt) onSelect([focusedOpt.value]);
      } else {
        onSelect(values);
      }
    }
  });

  const columnArrays: PickerOption<T>[][] = [];
  for (let c = 0; c < columns; c++) {
    columnArrays.push(options.slice(c * rows, c * rows + rows));
  }

  return (
    <Box flexDirection="column" alignItems={centered ? 'center' : undefined}>
      <PromptLabel message={message} />
      <Text color={Colors.muted}> (space to toggle, enter to submit)</Text>
      <Box
        flexDirection="row"
        gap={4}
        marginLeft={centered ? 0 : 2}
        marginTop={1}
      >
        {columnArrays.map((colOpts, colIdx) => (
          <Box key={colIdx} flexDirection="column">
            {colOpts.map((opt, rowIdx) => {
              const flatIdx = colIdx * rows + rowIdx;
              const isFocused = flatIdx === focused;
              const isSelected = selected.has(flatIdx);
              const label = opt.hint ? `${opt.label} (${opt.hint})` : opt.label;
              const checkbox = isSelected
                ? Icons.squareFilled
                : Icons.squareOpen;
              const key = showDigits ? numKey(flatIdx) : null;
              return (
                <Box key={flatIdx} gap={1}>
                  <Text
                    color={
                      isFocused
                        ? Colors.accent
                        : isSelected
                        ? 'white'
                        : Colors.muted
                    }
                  >
                    {checkbox}
                  </Text>
                  {key !== null && (
                    <Text color={isFocused ? Colors.accent : Colors.muted}>
                      [{key}]
                    </Text>
                  )}
                  <Text
                    color={isFocused ? Colors.accent : Colors.muted}
                    bold={isFocused}
                  >
                    {label}
                  </Text>
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>
    </Box>
  );
};
