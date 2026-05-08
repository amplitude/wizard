/**
 * TabContainer — Self-contained tabbed interface.
 * Absorbs BottomTabBar + StatusPanel functionality.
 *
 * Width awareness:
 *   - At ≥ TAB_HINT_THRESHOLD (60 cols) the right-aligned
 *     "← → to switch tabs" hint renders.
 *   - At ≥ TAB_FULL_THRESHOLD (50 cols) tabs render with their full
 *     label.
 *   - Below TAB_FULL_THRESHOLD tabs render in compact form, derived
 *     from the first word of each label, capped at 5 chars
 *     ("Snake (WASD)" → "Snake", "Logs" → "Logs", "Progress" → "Progr").
 *   - Each tab is a fixed-width Box with `flexShrink={0}` so labels
 *     never word-wrap mid-token.
 */

import { Box, Text } from 'ink';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { useState, useEffect, type ReactNode } from 'react';
import { Colors, Icons } from '../styles.js';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';
import { linkify } from '../utils/terminal-rendering.js';

export interface TabDefinition {
  id: string;
  label: string;
  component: ReactNode;
  /** Optional compact label override used below TAB_FULL_THRESHOLD. */
  shortLabel?: string;
}

interface TabContainerProps {
  tabs: TabDefinition[];
  statusMessage?: string;
  requestedTab?: string | null;
  onTabConsumed?: () => void;
  /**
   * Override the measured terminal width. Test-only — production
   * callers should leave this undefined and let useStdoutDimensions
   * supply it. The mock stdout in ink-testing-library hardcodes
   * `columns = 100`, so width-aware behaviour can't be exercised
   * without an explicit override.
   */
  widthOverride?: number;
}

/** Below this width, render compact tab labels. */
export const TAB_FULL_THRESHOLD = 50;
/** Below this width, drop the right-side "← → to switch tabs" hint. */
export const TAB_HINT_THRESHOLD = 60;

const COMPACT_LABEL_MAX = 5;

/**
 * Derive a compact tab label. Prefers an explicit `shortLabel`, then
 * the first whitespace-separated word truncated to COMPACT_LABEL_MAX.
 *
 * "Snake (WASD)" → "Snake"
 * "Progress" → "Progr"
 * "Logs" → "Logs"
 */
export const compactTabLabel = (tab: TabDefinition): string => {
  if (tab.shortLabel) return tab.shortLabel;
  const firstWord = tab.label.split(/\s+/)[0] ?? tab.label;
  return firstWord.length > COMPACT_LABEL_MAX
    ? firstWord.slice(0, COMPACT_LABEL_MAX)
    : firstWord;
};

export const TabContainer = ({
  tabs,
  statusMessage,
  requestedTab,
  onTabConsumed,
  widthOverride,
}: TabContainerProps) => {
  const [activeTab, setActiveTab] = useState(0);
  const [measuredCols] = useStdoutDimensions();
  const cols = widthOverride ?? measuredCols;

  useEffect(() => {
    if (!requestedTab) return;
    const idx = tabs.findIndex((t) => t.id === requestedTab);
    if (idx !== -1) setActiveTab(idx);
    onTabConsumed?.();
  }, [requestedTab]);

  useScreenInput((input, key) => {
    // Arrow keys always switch tabs (Snake uses WASD for movement)
    if (key.leftArrow) {
      setActiveTab((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.rightArrow) {
      setActiveTab((prev) => Math.min(tabs.length - 1, prev + 1));
      return;
    }

    // Number keys also work for tab switching (1-indexed)
    const num = parseInt(input, 10);
    if (!isNaN(num) && num >= 1 && num <= tabs.length) {
      setActiveTab(num - 1);
    }
  });

  const current = tabs[activeTab];
  const useCompactLabels = cols < TAB_FULL_THRESHOLD;
  const showSwitchHint = cols >= TAB_HINT_THRESHOLD;

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Active tab content — overflow hidden so it never pushes the bar off */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {current?.component}
      </Box>

      {/* Bottom chrome — fixed height so it always stays visible */}
      <Box flexDirection="column" flexShrink={0}>
        {/* Status bar */}
        {statusMessage && (
          <Box
            borderStyle="single"
            borderTop
            borderBottom={false}
            borderLeft={false}
            borderRight={false}
            borderColor={Colors.muted}
            paddingX={1}
            overflow="hidden"
          >
            <Text color={Colors.muted}>
              {Icons.diamondOpen} {linkify(statusMessage)}
            </Text>
          </Box>
        )}

        {/* Tab bar */}
        <Box height={1} />
        <Box
          gap={1}
          paddingX={1}
          justifyContent="space-between"
          overflow="hidden"
        >
          <Box gap={1}>
            {tabs.map((tab, i) => {
              const label = useCompactLabels ? compactTabLabel(tab) : tab.label;
              return (
                <Box key={tab.id} flexShrink={0}>
                  <Text
                    inverse={i === activeTab}
                    color={i === activeTab ? Colors.accent : Colors.muted}
                    bold={i === activeTab}
                  >
                    {` ${label} `}
                  </Text>
                </Box>
              );
            })}
          </Box>
          {showSwitchHint && (
            <Box flexShrink={0}>
              <Text color={Colors.muted}>← → to switch tabs</Text>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
};
