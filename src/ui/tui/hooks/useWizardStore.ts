/**
 * useWizardStore — eliminates repeated useSyncExternalStore boilerplate.
 *
 * Every screen had the same 4-line subscription pattern. This hook
 * replaces it with a single call. Memoizes the subscribe/getSnapshot
 * callbacks per-store so useSyncExternalStore doesn't resubscribe on
 * every render.
 */

import { useCallback, useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';

export function useWizardStore(store: WizardStore): void {
  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribe(onStoreChange),
    [store],
  );
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);
  useSyncExternalStore(subscribe, getSnapshot);
}
