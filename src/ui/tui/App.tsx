import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { Box } from 'ink';
import type { WizardStore } from './store.js';
import { createScreens, createServices } from './screen-registry.js';
import { CommandModeContext } from './context/CommandModeContext.js';
import { ConsoleView } from './components/ConsoleView.js';
import { TitleBar } from './components/TitleBar.js';
import { useStdoutDimensions } from './hooks/useStdoutDimensions.js';
import { DissolveTransition } from './primitives/DissolveTransition.js';
import { ScreenErrorBoundary } from './primitives/ScreenErrorBoundary.js';

const MIN_WIDTH = 80;
const MAX_WIDTH = 120;
/** Height reserved for separator + response line + input + up to 5 picker items. */
const CONSOLE_INPUT_HEIGHT = 8;

function getContentWidth(terminalColumns: number): number {
  if (terminalColumns < MIN_WIDTH) return terminalColumns;
  return Math.min(MAX_WIDTH, terminalColumns);
}

interface AppProps {
  store: WizardStore;
}

export const App = ({ store }: AppProps) => {
  const [columns, rows] = useStdoutDimensions();
  const services = useMemo(() => createServices(), []);
  const screens = useMemo(
    () => createScreens(store, services),
    [store, services],
  );

  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const width = getContentWidth(columns);
  const innerWidth = width - 2;
  // border(2) + titlebar(1) + gap(1) + console input area
  const contentHeight = Math.max(5, rows - 4 - CONSOLE_INPUT_HEIGHT);
  // innerWidth minus paddingX(1) on each side
  const contentAreaWidth = Math.max(10, innerWidth - 2);
  const direction = store.lastNavDirection === 'pop' ? 'right' : 'left';
  const activeScreen: ReactNode = screens[store.currentScreen] ?? null;

  return (
    <CommandModeContext.Provider value={store.commandMode}>
      <Box
        flexDirection="column"
        height={rows}
        width={columns}
        alignItems="center"
        justifyContent="flex-start"
      >
        <ConsoleView store={store} width={width} height={rows}>
          <TitleBar version={store.version} width={innerWidth} />
          <Box height={1} />
          <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
            <DissolveTransition
              transitionKey={store.currentScreen}
              width={contentAreaWidth}
              height={contentHeight}
              direction={direction}
            >
              <ScreenErrorBoundary store={store}>
                {activeScreen}
              </ScreenErrorBoundary>
            </DissolveTransition>
          </Box>
        </ConsoleView>
      </Box>
    </CommandModeContext.Provider>
  );
};
