/**
 * TabContainer — Self-contained tabbed interface.
 *
 * Owns the tab bar at the bottom; that bar is part of the immutable
 * bottom chrome (along with the KeyHintBar in ConsoleView, which lives
 * below us) and stays pinned to the terminal bottom regardless of the
 * active tab's content height.
 *
 * History: a previous attempt let the tab bar "rise" to meet short
 * content (Progress during cold-start) by collapsing the outer flex
 * grow. That left the KeyHintBar pinned and split the chrome into two
 * clusters with empty space wedged between them — strictly worse than
 * the original gap. The status-pill row that used to live here was
 * always content-adjacent semantics ("what is the wizard doing right
 * now"), so it now renders as the last row of the active tab's own
 * content area instead of as part of the chrome. See PR follow-up to
 * #688 for the motivating screenshot and discussion.
 */

import { Box, Text } from 'ink';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { useState, useEffect, type ReactNode } from 'react';
import { Colors } from '../styles.js';

export interface TabDefinition {
  id: string;
  label: string;
  component: ReactNode;
}

interface TabContainerProps {
  tabs: TabDefinition[];
  requestedTab?: string | null;
  onTabConsumed?: () => void;
}

export const TabContainer = ({
  tabs,
  requestedTab,
  onTabConsumed,
}: TabContainerProps) => {
  const [activeTab, setActiveTab] = useState(0);

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

  return (
    // The whole bottom chrome cluster (tab bar + the KeyHintBar that lives
    // below us in ConsoleView) must stay pinned to the terminal bottom so
    // it reads as one chrome unit rather than two. We grow the outer Box
    // unconditionally; tabs whose content is short (Progress during
    // cold-start) handle their own bottom-row composition by placing
    // content-adjacent rows (status pill) inside their own flex tree.
    //
    // `flexShrink={1}` on the outer + content boxes lets the content
    // area give back rows to the chrome when a tab's content exceeds
    // the viewport (e.g. the LogViewer's full scroll buffer on a
    // short terminal). Without it, the parent's overflow=hidden could
    // clip the bottom chrome. The content area's own
    // `overflow="hidden"` then clips the excess content rather than
    // the chrome — same approach the previous follow-up commit used.
    <Box flexDirection="column" flexGrow={1} flexShrink={1}>
      {/* Active tab content — overflow hidden so it never pushes the bar off */}
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
        {current?.component}
      </Box>

      {/* Bottom chrome — fixed height, pinned to the terminal bottom so
          it forms one chrome cluster with the KeyHintBar in ConsoleView
          below us. A 1-row spacer keeps the tab bar from getting
          smushed into the content tail when a tab's last row is
          non-empty. */}
      <Box flexDirection="column" flexShrink={0}>
        <Box height={1} />

        {/* Tab bar */}
        <Box gap={1} paddingX={1} justifyContent="space-between">
          <Box gap={1}>
            {tabs.map((tab, i) => (
              <Text
                key={tab.id}
                inverse={i === activeTab}
                color={i === activeTab ? Colors.accent : Colors.muted}
                bold={i === activeTab}
              >
                {` ${tab.label} `}
              </Text>
            ))}
          </Box>
          <Text color={Colors.muted}>← → to switch tabs</Text>
        </Box>
      </Box>
    </Box>
  );
};
