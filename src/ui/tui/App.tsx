/**
 * App — Root component.
 *
 * Layout (top to bottom):
 *   1. JourneyStepper (1 line) — progress through the flow
 *   2. HeaderBar (1 line) — title + org/project context
 *   3. Separator
 *   4. Content area (flex grow) — active screen
 *   5. ConsoleView bottom area — separator + hints + input
 *
 * No outer border. Full terminal width (capped at 120).
 */

import { useMemo, type ReactNode } from 'react';
import { Box, Text } from 'ink';
import type { WizardStore } from './store.js';
import { createScreens, createServices } from './screen-registry.js';
import { CommandModeContext } from './context/CommandModeContext.js';
import { ConsoleView } from './components/ConsoleView.js';
import { CtrlCHandler } from './components/CtrlCHandler.js';
import { HeaderBar } from './components/HeaderBar.js';
import { JourneyStepper } from './components/JourneyStepper.js';
import { useStdoutDimensions } from './hooks/useStdoutDimensions.js';
import { useWizardStore } from './hooks/useWizardStore.js';
import { DissolveTransition } from './primitives/index.js';
import { ScreenErrorBoundary } from './primitives/index.js';
import { Screen } from './router.js';
import { Colors, Layout } from './styles.js';

/**
 * Screens that should animate together as a single visual step.
 *
 * `DissolveTransition` fires its wipe animation whenever `transitionKey`
 * changes. Screens in the same group resolve to the same key, which
 * suppresses the animation between them — the content swaps instantly
 * while the surrounding chrome and perceived "step" stays stable.
 *
 * Used for the signup ceremony, where the router advances through
 * SignupEmail → SigningUp → SignupFullName → SigningUp without any
 * meaningful step change from the user's perspective. Each screen
 * renders a layout that continues the visual context of the previous
 * one (see `SigningUpScreen.tsx` — mimics the preceding input screen),
 * so without the wipe, the three components look like one screen
 * updating in place.
 */
const TRANSITION_GROUPS: Partial<Record<string, string>> = {
  [Screen.SignupEmail]: 'signup',
  [Screen.SigningUp]: 'signup',
  [Screen.SignupFullName]: 'signup',
};

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

  useWizardStore(store);

  const width = getContentWidth(columns);
  const contentHeight = Math.max(5, rows - CHROME_HEIGHT);
  const contentAreaWidth = Math.max(10, width - Layout.paddingX * 2);
  const direction = store.lastNavDirection === 'pop' ? 'right' : 'left';
  const activeScreen: ReactNode = screens[store.currentScreen] ?? null;
  // Screens in the same transition group share a key so DissolveTransition
  // doesn't animate between them (see TRANSITION_GROUPS docstring above).
  const transitionKey =
    TRANSITION_GROUPS[store.currentScreen] ?? store.currentScreen;

  const separator = Layout.separatorChar.repeat(Math.max(0, width - 2));

  return (
    <CommandModeContext.Provider value={store.commandMode}>
      {/* Always-on Ctrl+C interceptor. Uses Ink's useInput so it gets
          the key event in raw mode. Drives graceful-exit flow directly
          (banner → save checkpoint → flush analytics → exit). */}
      <CtrlCHandler store={store} />
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
            width={width}
            orgName={store.session.selectedOrgName}
            workspaceName={store.session.selectedWorkspaceName}
            envName={store.session.selectedEnvName}
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
              transitionKey={transitionKey}
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
