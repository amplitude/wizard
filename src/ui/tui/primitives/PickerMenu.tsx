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

/**
 * First-frame fallback chrome size, used before `measureElement` has run.
 * After the initial layout pass we replace this with the measured header
 * height plus a small allowance for scroll indicators and bottom padding.
 */
const PICKER_CHROME_ROWS_FALLBACK = 16;

/** Minimum number of visible options on extremely short terminals. */
const MIN_VISIBLE_ROWS = 5;

/**
 * Reserve rows beyond the measured header for: optional "↑ N more" /
 * "↓ N more" indicators (up to 2) plus a one-row safety buffer for the
 * keyboard hint bar / cursor below the picker.
 */
const CHROME_FOOTER_RESERVE_ROWS = 3;

/**
 * Pure helper — translate measured header height + terminal rows into
 * the number of option rows that fit. Extracted for unit testing.
 *
 * @param termRows Total terminal rows.
 * @param measuredHeaderRows Header height from `measureElement`, or
 *   `null` if not yet measured (first-frame fallback path).
 * @param totalOptionRows Total option rows we'd render in unbounded space
 *   (i.e. ceil(options.length / columns)).
 */
export function computeVisibleCount(
  termRows: number,
  measuredHeaderRows: number | null,
  totalOptionRows: number,
): number {
  const chromeRows =
    measuredHeaderRows !== null
      ? measuredHeaderRows + CHROME_FOOTER_RESERVE_ROWS
      : PICKER_CHROME_ROWS_FALLBACK;
  const available = termRows - chromeRows;
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

/** Render a single picker item row. */
const PickerItem = <T,>({
  opt,
  isFocused,
  index,
}: {
  opt: PickerOption<T>;
  isFocused: boolean;
  index: number;
}) => {
  const label = opt.hint ? `${opt.label} (${opt.hint})` : opt.label;
  const key = numKey(index);
  return (
    <Box gap={1}>
      <Text color={isFocused ? Colors.accent : Colors.muted}>
        {isFocused ? Icons.triangleSmallRight : ' '}
      </Text>
      {key !== null && (
        <Text color={isFocused ? Colors.accent : Colors.muted}>[{key}]</Text>
      )}
      <Text color={isFocused ? Colors.accent : Colors.muted} bold={isFocused}>
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
  onSelect,
}: {
  message?: string;
  options: PickerOption<T>[];
  centered?: boolean;
  columns?: number;
  onSelect: (value: T | T[]) => void;
}) => {
  const [focused, setFocused] = useState(0);
  const [, termRows] = useStdoutDimensions();
  const scrollRef = useRef(0);
  const headerRef = useRef<DOMElement>(null);
  // Measured header height — `null` until Ink has laid out the first frame.
  // We re-measure on every render so wrapping changes (terminal resize,
  // message text changes) update visibleCount on the next paint.
  const [measuredHeader, setMeasuredHeader] = useState<number | null>(null);
  const rowsPerCol = Math.ceil(options.length / columns);

  useEffect(() => {
    if (!headerRef.current) return;
    const { height } = measureElement(headerRef.current);
    if (height > 0 && height !== measuredHeader) {
      setMeasuredHeader(height);
    }
  });

  const maxVisible =
    columns === 1
      ? computeVisibleCount(termRows, measuredHeader, rowsPerCol)
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
    const col = Math.floor(focused / rowsPerCol);
    const row = focused % rowsPerCol;

    // Number keys 1–9 select options 0–8; 0 selects option 9
    const digit = parseInt(input, 10);
    if (!isNaN(digit) && !key.ctrl && !key.meta) {
      const idx = digit === 0 ? 9 : digit - 1;
      const opt = options[idx];
      if (opt) {
        onSelect(opt.value);
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
        onSelect(selected.value);
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
          />
        ))}
        {hasBelow && (
          <Text color={Colors.muted}>
            {'  \u2193 '}
            {options.length - scrollOffset - maxVisible} more
          </Text>
        )}
      </Box>
    );
  }

  // Multi-column / short-list: render all items in column-first grid
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
            {colOpts.map((opt, rowIdx) => (
              <PickerItem
                key={colIdx * rowsPerCol + rowIdx}
                opt={opt}
                index={colIdx * rowsPerCol + rowIdx}
                isFocused={colIdx * rowsPerCol + rowIdx === focused}
              />
            ))}
          </Box>
        ))}
      </Box>
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

    // Number keys 1–9 toggle options 0–8; 0 toggles option 9
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
      // Numeric sort — default Array.prototype.sort is lexicographic and
      // would put index 10 before index 2.
      const values = [...selected]
        .sort((a, b) => a - b)
        .map((i) => options[i].value);
      if (values.length === 0 && !defaultSelected?.length) {
        // Nothing was ever pre-selected and user pressed Enter without
        // toggling anything — treat that as "use the focused row" so the
        // picker always submits something. (This was the original behavior.)
        const focusedOpt = options[focused];
        if (focusedOpt) onSelect([focusedOpt.value]);
      } else {
        // If the caller pre-selected items, an empty set means the user
        // deliberately unchecked everything — pass [] so the caller can
        // treat it as "skip" or whatever they want.
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
              const key = numKey(flatIdx);
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
