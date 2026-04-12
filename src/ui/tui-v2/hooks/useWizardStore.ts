/**
 * useWizardStore — eliminates repeated useSyncExternalStore boilerplate.
 *
 * Every v2 screen had the same 4-line subscription pattern. This hook
 * replaces it with a single call. Uses .bind() for stable references
 * to avoid unnecessary resubscription on render.
 */

import { useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';

export function useWizardStore(store: WizardStore): void {
  useSyncExternalStore(
    store.subscribe.bind(store),
    store.getSnapshot.bind(store),
  );
}
