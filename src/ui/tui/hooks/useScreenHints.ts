/**
 * useScreenHints — per-screen KeyHintBar registration (audit 2.3).
 *
 * Screens call `useScreenHints([{ key: 'Enter', label: 'Continue' }, ...])`
 * to declare which keys are active on that screen. The ConsoleView reads
 * the atom via `useScreenHintsValue()` and renders them alongside the
 * always-present `/` and `Tab` defaults.
 *
 * Hints are module-scoped (not per-store) because at any moment only one
 * screen is active. On unmount / re-render with a different hint set, the
 * atom is overwritten so stale hints never stick around.
 */

import { atom } from 'nanostores';
import { useStore } from '@nanostores/react';
import { useEffect } from 'react';
import type { KeyHint } from '../components/KeyHintBar.js';

/** Empty array literal reused so identity stays stable when no hints. */
const EMPTY_HINTS: readonly KeyHint[] = Object.freeze([]);

const $screenHints = atom<readonly KeyHint[]>(EMPTY_HINTS);

/**
 * Register the calling screen's hint list. Clears when the screen unmounts.
 *
 * Stable-identity callers (e.g. a hoisted `const HINTS = [...]` at module
 * scope) avoid re-writing the atom on every render.
 */
export function useScreenHints(hints: readonly KeyHint[] | undefined): void {
  useEffect(() => {
    $screenHints.set(hints ?? EMPTY_HINTS);
    return () => {
      // Only reset if we are still the owner of the current value.
      if ($screenHints.get() === (hints ?? EMPTY_HINTS)) {
        $screenHints.set(EMPTY_HINTS);
      }
    };
  }, [hints]);
}

/** Subscribe to the current screen's hint list (used by ConsoleView). */
export function useScreenHintsValue(): readonly KeyHint[] {
  return useStore($screenHints);
}

/** Test-only — reset the module atom between test cases. */
export function __resetScreenHintsForTests(): void {
  $screenHints.set(EMPTY_HINTS);
}
