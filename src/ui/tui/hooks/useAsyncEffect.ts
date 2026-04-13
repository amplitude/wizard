/**
 * useAsyncEffect — AbortController-based async effect hook.
 *
 * Automatically aborts in-flight async work when the effect re-runs
 * or the component unmounts. Prevents stale state writes from
 * completed promises that arrive after the component has moved on.
 *
 * Usage:
 *   useAsyncEffect(async (signal) => {
 *     const data = await fetch(url, { signal });
 *     if (!signal.aborted) setData(data);
 *   }, [url]);
 */

import { useEffect, useRef, type DependencyList } from 'react';
import { logToFile } from '../../../utils/debug.js';

export function useAsyncEffect(
  effect: (signal: AbortSignal) => Promise<void>,
  deps: DependencyList,
): void {
  // Use a ref to always call the latest effect without re-subscribing
  const effectRef = useRef(effect);
  effectRef.current = effect;

  useEffect(() => {
    const controller = new AbortController();
    void effectRef.current(controller.signal).catch((err: unknown) => {
      // Silently ignore abort errors — they're expected on cleanup
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (err instanceof Error && err.name === 'AbortError') return;
      if (controller.signal.aborted) return;
      // Log other errors but don't crash — screen error boundary handles display

      logToFile(
        `[useAsyncEffect] ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    return () => controller.abort();
  }, deps);
}
