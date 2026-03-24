/**
 * Screen registry — maps screen names to React components.
 *
 * Adding a new screen:
 *   1. Create the component in screens/
 *   2. Add an entry here
 *   3. Add the screen name to the router flow (router.ts)
 *
 * App.tsx never needs to change.
 */

import type { ReactNode } from 'react';
import type { WizardStore } from './store.js';
import { Screen, Overlay, type ScreenName } from './router.js';

import { OutageScreen } from './screens/OutageScreen.js';
import { SettingsOverrideScreen } from './screens/SettingsOverrideScreen.js';
import { IntroScreen } from './screens/IntroScreen.js';
import { SetupScreen } from './screens/SetupScreen.js';
import { AuthScreen } from './screens/AuthScreen.js';
import { RegionSelectScreen } from './screens/RegionSelectScreen.js';
import { DataSetupScreen } from './screens/DataSetupScreen.js';
import { ActivationOptionsScreen } from './screens/ActivationOptionsScreen.js';
import { RunScreen } from './screens/RunScreen.js';
import { McpScreen } from './screens/McpScreen.js';
import { SlackScreen } from './screens/SlackScreen.js';
import { LogoutScreen } from './screens/LogoutScreen.js';
import { OutroScreen } from './screens/OutroScreen.js';
import { createMcpInstaller } from './services/mcp-installer.js';
import type { McpInstaller } from './services/mcp-installer.js';
import { SnakeGame } from './primitives/SnakeGame.js';

export interface ScreenServices {
  mcpInstaller: McpInstaller;
}

export function createServices(localMcp = false): ScreenServices {
  return {
    mcpInstaller: createMcpInstaller(localMcp),
  };
}

export function createScreens(
  store: WizardStore,
  services: ScreenServices,
): Record<ScreenName, ReactNode> {
  return {
    // Overlays
    [Overlay.Outage]: <OutageScreen store={store} />,
    [Overlay.SettingsOverride]: <SettingsOverrideScreen store={store} />,
    [Overlay.Snake]: <SnakeGame onExit={() => store.hideSnakeOverlay()} />,
    [Overlay.Mcp]: (
      <McpScreen
        store={store}
        installer={services.mcpInstaller}
        onComplete={() => store.hideMcpOverlay()}
      />
    ),
    [Overlay.Slack]: (
      <SlackScreen store={store} onComplete={() => store.hideSlackOverlay()} />
    ),
    [Overlay.Logout]: (
      <LogoutScreen onComplete={() => store.hideLogoutOverlay()} />
    ),

    // Wizard flow
    [Screen.Intro]: <IntroScreen store={store} />,
    [Screen.Setup]: <SetupScreen store={store} />,
    [Screen.Auth]: <AuthScreen store={store} />,
    [Screen.RegionSelect]: <RegionSelectScreen store={store} />,
    [Screen.DataSetup]: <DataSetupScreen store={store} />,
    [Screen.ActivationOptions]: <ActivationOptionsScreen store={store} />,
    [Screen.Options]: null,
    [Screen.Run]: <RunScreen store={store} />,
    [Screen.Mcp]: <McpScreen store={store} installer={services.mcpInstaller} />,
    [Screen.Outro]: <OutroScreen store={store} />,

    // Standalone MCP flows
    [Screen.McpAdd]: (
      <McpScreen store={store} installer={services.mcpInstaller} standalone />
    ),
    [Screen.McpRemove]: (
      <McpScreen
        store={store}
        installer={services.mcpInstaller}
        mode="remove"
        standalone
      />
    ),

    // Slack integration (in-wizard step and standalone flow)
    [Screen.Slack]: <SlackScreen store={store} />,
    [Screen.SlackSetup]: <SlackScreen store={store} standalone />,
  };
}
