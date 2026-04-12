/**
 * App v2 — Root component.
 *
 * Layout (top to bottom):
 *   1. JourneyStepper (1 line) — progress through the flow
 *   2. HeaderBar (1 line) — title + org/project context
 *   3. Separator
 *   4. Content area (flex grow) — active screen
 *   5. ConsoleView bottom area — separator + hints + input
 *
 * No outer border. Full terminal width (capped at 120). Spacious.
 */

import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { Box, Text } from 'ink';
import type { WizardStore } from './store.js';
import { createScreens, createServices } from './screen-registry.js';
import { CommandModeContext } from './context/CommandModeContext.js';
import { ConsoleView } from './components/ConsoleView.js';
import { HeaderBar } from './components/HeaderBar.js';
import { JourneyStepper } from './components/JourneyStepper.js';
import { useStdoutDimensions } from './hooks/useStdoutDimensions.js';
import { DissolveTransition } from './primitives/index.js';
import { ScreenErrorBoundary } from './primitives/index.js';
import { Colors, Layout } from './styles.js';

/** Height reserved for stepper + header + separators + hint bar + input. */
const CHROME_HEIGHT = 8;

function getContentWidth(terminalColumns: number): number {
  if (terminalColumns < Layout.minWidth) return terminalColumns;
  return Math.min(Layout.maxWidth, terminalColumns);
}

interface AppProps {
  store: WizardStore;
}

export const App = ({ store }: AppProps) => {
  const [columns, rows] = useStdoutDimensions();
  const services = useMemo(() => createServices(store.session.localMcp), []);
  const screens = useMemo(
    () => createScreens(store, services),
    [store, services],
  );

  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const width = getContentWidth(columns);
  const contentHeight = Math.max(5, rows - CHROME_HEIGHT);
  const contentAreaWidth = Math.max(10, width - Layout.paddingX * 2);
  const direction = store.lastNavDirection === 'pop' ? 'right' : 'left';
  const activeScreen: ReactNode = screens[store.currentScreen] ?? null;

  const separator = Layout.separatorChar.repeat(Math.max(0, width - 2));

  return (
    <CommandModeContext.Provider value={store.commandMode}>
      <Box
        flexDirection="column"
        height={rows}
        width={columns}
        alignItems="center"
        justifyContent="flex-start"
      >
        <Box flexDirection="column" width={width}>
          {/* Journey stepper */}
          <JourneyStepper store={store} width={width} />

          {/* Header bar */}
          <HeaderBar
            version={store.version}
            width={width}
            orgName={store.session.selectedOrgName}
            projectName={store.session.selectedProjectName}
          />

          {/* Top separator */}
          <Box paddingX={1}>
            <Text color={Colors.border}>{separator}</Text>
          </Box>
        </Box>

        {/* Content + console input */}
        <ConsoleView store={store} width={width} height={rows - 3}>
          <Box
            flexDirection="column"
            flexGrow={1}
            paddingX={Layout.paddingX}
            overflow="hidden"
          >
            <DissolveTransition
              transitionKey={store.currentScreen}
              width={contentAreaWidth}
              height={contentHeight}
              direction={direction}
            >
              <ScreenErrorBoundary
                store={store}
                retryToken={store.screenErrorRetry}
              >
                {activeScreen}
              </ScreenErrorBoundary>
            </DissolveTransition>
          </Box>
        </ConsoleView>
      </Box>
    </CommandModeContext.Provider>
  );
};
