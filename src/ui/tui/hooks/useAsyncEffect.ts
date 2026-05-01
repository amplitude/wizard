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
 *
 * Errors thrown by the effect (other than AbortError) are forwarded to
 * `onError` if provided. The default behavior is unchanged: log to file
 * only. Pass `onError: (err) => store.setScreenError(err)` (or any other
 * surfacing path) when an effect's failure should reach the user instead
 * of disappearing into the log.
 */

import { useEffect, useRef, type DependencyList } from 'react';
import { logToFile } from '../../../utils/debug.js';

export interface UseAsyncEffectOptions {
  /**
   * Called when the effect throws a non-abort error. Use this to surface
   * failures to the user (e.g. by routing into the screen error boundary
   * via `store.setScreenError`). When omitted, errors are only logged to
   * file — the historical behavior.
   */
  onError?: (err: unknown) => void;
}

export function useAsyncEffect(
  effect: (signal: AbortSignal) => Promise<void>,
  deps: DependencyList,
  options?: UseAsyncEffectOptions,
): void {
  // Use a ref to always call the latest effect without re-subscribing
  const effectRef = useRef(effect);
  effectRef.current = effect;
  const onErrorRef = useRef(options?.onError);
  onErrorRef.current = options?.onError;

  useEffect(() => {
    const controller = new AbortController();
    void effectRef.current(controller.signal).catch((err: unknown) => {
      // Silently ignore abort errors — they're expected on cleanup
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (err instanceof Error && err.name === 'AbortError') return;
      if (controller.signal.aborted) return;
      // Always log to file so devs have a breadcrumb. If the caller
      // opted in to surfacing, also forward — that path handles the
      // user-visible side (banner, screen error boundary, etc.). The
      // try/catch around onError keeps a buggy handler from crashing
      // the screen on top of the original failure.
      logToFile(
        `[useAsyncEffect] ${err instanceof Error ? err.message : String(err)}`,
      );
      const onError = onErrorRef.current;
      if (onError) {
        try {
          onError(err);
        } catch (handlerErr) {
          logToFile(
            `[useAsyncEffect] onError handler threw: ${
              handlerErr instanceof Error
                ? handlerErr.message
                : String(handlerErr)
            }`,
          );
        }
      }
    });
    return () => controller.abort();
  }, deps);
}
