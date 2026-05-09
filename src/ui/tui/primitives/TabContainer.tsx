/**
 * TabContainer — Self-contained tabbed interface.
 * Absorbs BottomTabBar + StatusPanel functionality.
 */

import { Box, Text } from 'ink';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { useState, useEffect, type ReactNode } from 'react';
import { Colors, Icons } from '../styles.js';
import { linkify } from '../utils/terminal-rendering.js';

export interface TabDefinition {
  id: string;
  label: string;
  component: ReactNode;
}

interface TabContainerProps {
  tabs: TabDefinition[];
  statusMessage?: string;
  requestedTab?: string | null;
  onTabConsumed?: () => void;
}

export const TabContainer = ({
  tabs,
  statusMessage,
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
    <Box flexDirection="column" flexGrow={1}>
      {/* Active tab content — overflow hidden so it never pushes the bar off */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {current?.component}
      </Box>

      {/* Bottom chrome — fixed height so it always stays visible.
          Spacing rule: when a status message is rendered, its top border
          is the visual separator from content above, and we let the tab
          bar sit directly underneath (no extra spacer). When there's no
          status, we reserve a single 1-row spacer so the tab bar isn't
          smushed into the content tail. The previous layout always
          inserted both the spacer AND a top-bordered status bar, which
          produced the awkwardly-wide gap users called out when content
          was short. */}
      <Box flexDirection="column" flexShrink={0}>
        {/* Status bar (with top border that doubles as content separator) */}
        {statusMessage ? (
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
        ) : (
          <Box height={1} />
        )}

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
