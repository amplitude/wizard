import { useMemo, useSyncExternalStore } from 'react';
import { ScreenContainer } from './primitives/index.js';
import type { WizardStore } from './store.js';
import { createScreens, createServices } from './screen-registry.js';
import { CommandModeContext } from './context/CommandModeContext.js';

interface AppProps {
  store: WizardStore;
}

export const App = ({ store }: AppProps) => {
  const services = useMemo(() => createServices(), []);
  const screens = useMemo(
    () => createScreens(store, services),
    [store, services],
  );

  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  return (
    <CommandModeContext.Provider value={store.commandMode}>
      <ScreenContainer store={store} screens={screens} />
    </CommandModeContext.Provider>
  );
};
