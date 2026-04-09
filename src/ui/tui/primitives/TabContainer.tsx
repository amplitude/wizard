/**
 * TabContainer — Self-contained tabbed interface.
 * Absorbs BottomTabBar + StatusPanel functionality.
 */

import { Box, Text } from 'ink';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { useState, useEffect, type ReactNode } from 'react';
import { Colors, Icons } from '../styles.js';

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

  useScreenInput((input) => {
    if (input === '[') {
      setActiveTab((prev) => Math.max(0, prev - 1));
    }
    if (input === ']') {
      setActiveTab((prev) => Math.min(tabs.length - 1, prev + 1));
    }
  });

  const current = tabs[activeTab];

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
              {Icons.diamondOpen} {statusMessage}
            </Text>
          </Box>
        )}

        {/* Tab bar */}
        <Box height={1} />
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
          <Text color={Colors.muted}>
            [ ] to browse tabs while the wizard runs
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
