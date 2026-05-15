/**
 * useAtomSelector — narrow selector subscription over the WizardStore.
 *
 * The store's underlying atoms are private; the canonical subscribe path
 * is `store.subscribe(cb)` which fires on ANY change (it listens on
 * `$version`). Components that consume only a slice (e.g. just
 * `tasks.slice(0, 5)`) still re-render on every tick today via
 * `useWizardStore` because the hook reads the version number as its
 * snapshot.
 *
 * This hook fixes that for the Timeline UX: callers pass a selector that
 * extracts the slice they care about, and the hook memoizes the result
 * with `isEqual` (default `===`) so React's `useSyncExternalStore`
 * returns the SAME object reference between renders when the slice
 * hasn't logically changed. Re-renders still fire on every store tick
 * (we can't suppress that without changing the store's notify model),
 * but consumers that pass this slice into deeper memoized children
 * (e.g. `React.memo`) will skip subtree work when the slice is
 * unchanged.
 *
 * For deeper render-skip semantics in PR 5+, the caller can pass a
 * structural `isEqual` (shallow array / object compare).
 *
 * Why not @nanostores/react? The repo intentionally avoids that peer
 * dep (see useScreenHints' comment) and the store's atoms aren't
 * exposed for direct subscription anyway.
 */

import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { WizardStore } from '../store.js';

/**
 * Subscribe to a slice of the wizard store. Returns the result of
 * `selector(store)`, memoized so the reference is stable when the
 * `isEqual` check passes.
 *
 * @param store    The WizardStore instance.
 * @param selector Pure function that derives the slice from the store.
 *                 Must be stable (declare at module / component scope, or
 *                 wrap in `useCallback`) so React's
 *                 `useSyncExternalStore` doesn't resubscribe per render.
 * @param isEqual  Equality check between the previous and next slice.
 *                 Defaults to `Object.is`. Pass a shallow / deep compare
 *                 for arrays or objects you want to dedupe by value.
 */
export function useAtomSelector<S>(
  store: WizardStore,
  selector: (store: WizardStore) => S,
  isEqual: (a: S, b: S) => boolean = Object.is,
): S {
  const subscribe = useCallback(
    (onChange: () => void) => store.subscribe(onChange),
    [store],
  );

  // Cached snapshot so identity stays stable across ticks when the
  // selector returns an equal value. Without this, useSyncExternalStore
  // would call selector on each version bump and return a fresh array /
  // object on every render, defeating downstream React.memo.
  const cached = useRef<{ value: S; initialised: boolean }>({
    value: undefined as unknown as S,
    initialised: false,
  });

  const getSnapshot = useCallback((): S => {
    const next = selector(store);
    if (!cached.current.initialised) {
      cached.current = { value: next, initialised: true };
      return next;
    }
    if (isEqual(cached.current.value, next)) {
      return cached.current.value;
    }
    cached.current = { value: next, initialised: true };
    return next;
  }, [store, selector, isEqual]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Shallow-array equality — same length AND every element equal by
 * `Object.is`. Handy default for selectors returning a list slice
 * (status messages, top-N tasks, last-N file writes).
 */
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
