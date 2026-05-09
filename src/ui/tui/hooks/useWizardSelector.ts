/**
 * useWizardSelector — equality-checked slice subscription.
 *
 * Part of v2 PR 5 (TUI redesign). The brief calls for "render-cost
 * teardown" — replacing whole-store subscriptions (`useWizardStore(store)`)
 * with slice-level subscriptions for components that only care about a
 * narrow piece of state. Without slicing, every store version bump
 * forced React to reconcile every subscriber regardless of whether the
 * data they read actually changed; with slicing, a tick that only
 * mutates `tasks` no longer re-renders the FileWritesPanel, the
 * DiscoveryFeed, or the JourneyStepper.
 *
 * Implementation notes:
 *
 *   - We use `useSyncExternalStore` (the same primitive `useWizardStore`
 *     is built on) but pair it with a per-render selector and an
 *     equality check.
 *   - The store's `subscribe`/`getSnapshot` are stable references,
 *     so the subscription is created once per (store, selector ref).
 *   - The selector is stored in a ref so callers can pass an inline
 *     arrow without triggering a re-subscribe on every render. Every
 *     `getSnapshot` re-invocation reads through the ref so the latest
 *     selector wins. This matches the React 18 useSyncExternalStore
 *     selector pattern (`useSyncExternalStoreWithSelector`-style).
 *   - The default equality is `Object.is`. Callers reading reference
 *     types (arrays, objects) MUST pass a shallow-equal or deep-equal
 *     comparator, otherwise every store tick that returns a new
 *     reference (even if structurally identical) will trigger a
 *     rerender — defeating the purpose.
 *
 * Tests live in `src/ui/tui/hooks/__tests__/useWizardSelector.test.tsx`.
 */
import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';

export type Equality<T> = (a: T, b: T) => boolean;

/**
 * Subscribe to a *slice* of the wizard store. The component only
 * re-renders when `selector(store)` changes per the equality function.
 *
 * @param store     the wizard store
 * @param selector  pure function reading the slice of interest
 * @param isEqual   equality comparator (default: `Object.is`)
 * @returns         the latest selected value
 */
export function useWizardSelector<T>(
  store: WizardStore,
  selector: (store: WizardStore) => T,
  isEqual: Equality<T> = Object.is,
): T {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const lastValueRef = useRef<{ value: T; set: boolean }>({
    value: undefined as unknown as T,
    set: false,
  });

  // `subscribe` is stable per store. We don't recreate it on every
  // render even though the closure captures `selectorRef` — the ref's
  // identity is stable, so every callback observes the latest selector.
  const subscribe = useCallback(
    (onChange: () => void) => store.subscribe(onChange),
    [store],
  );

  // `getSnapshot` MUST return a stable identity when the selected slice
  // hasn't changed, because `useSyncExternalStore` calls `Object.is` on
  // consecutive snapshots to decide whether to bail out. We cache the
  // last selected value in a ref and only update it when the equality
  // check returns false.
  const getSnapshot = useCallback(() => {
    const next = selectorRef.current(store);
    const prev = lastValueRef.current;
    if (!prev.set || !isEqual(prev.value, next)) {
      lastValueRef.current = { value: next, set: true };
    }
    return lastValueRef.current.value;
  }, [store, isEqual]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ── Common equality helpers ────────────────────────────────────────────

/** Shallow array equality (length + per-index `Object.is`). */
export function shallowArrayEqual<T>(
  a: readonly T[],
  b: readonly T[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

/** Shallow object equality (same keys + per-key `Object.is`). */
export function shallowObjectEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  if (a === b) return true;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    // Length parity alone is not enough: `{x: undefined, y: 1}` vs
    // `{z: undefined, y: 1}` both have 2 keys, and reading `b.x` would
    // yield `undefined === undefined`. Verify `b` actually has each key
    // before comparing values so disjoint key sets don't pass.
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!Object.is(a[k], b[k])) return false;
  }
  return true;
}
