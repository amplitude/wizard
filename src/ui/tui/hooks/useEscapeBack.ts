/**
 * useEscapeBack — wires Esc to back-navigation on the calling screen.
 *
 * Only fires when `store.canGoBack()` is true at the moment Esc is pressed,
 * so it self-disables on the first decision-point screen and on any screen
 * that sits behind a back-stop wall (e.g. after the agent Run completes).
 *
 * Also registers the `[Esc] Back` key hint via `useScreenHints` whenever
 * back is available, so the hint bar reflects what the keystroke actually
 * does. Existing screen-specific hints can be merged via `extraHints`.
 *
 * Design rationale: Esc was chosen over Shift+Tab because Esc-as-back is
 * the dominant convention in TUI wizards (Claude Code, npm init,
 * create-next-app, k9s, lazygit) and reads as "step out of this decision"
 * to most users. Screens that already bind Esc to a screen-specific
 * action (skip, cancel) opt out by simply not calling this hook.
 */

import { useMemo } from 'react';
import type { WizardStore } from '../store.js';
import type { KeyHint } from '../components/KeyHintBar.js';
import { useScreenHints } from './useScreenHints.js';
import { useScreenInput } from './useScreenInput.js';
import { useWizardStore } from './useWizardStore.js';

const BACK_HINT: KeyHint = { key: 'Esc', label: 'Back' };
const EMPTY_HINTS: readonly KeyHint[] = Object.freeze([]);

interface UseEscapeBackOptions {
  /** Hints to render alongside `[Esc] Back`. */
  extraHints?: readonly KeyHint[];
  /**
   * Force-disable the hook (e.g. while a screen is in a phase where
   * back would be confusing — submitting a form, mid-API-call, etc).
   * Defaults to true.
   */
  enabled?: boolean;
}

export function useEscapeBack(
  store: WizardStore,
  options: UseEscapeBackOptions = {},
): void {
  // Subscribe so canGoBack() re-evaluates when session state changes.
  useWizardStore(store);

  const { extraHints, enabled = true } = options;
  const canGoBack = enabled && store.canGoBack();

  // Memoize so useScreenHints' effect dep-equality stays stable across
  // renders that don't actually change the rendered hints.
  const hints = useMemo<readonly KeyHint[]>(() => {
    if (!canGoBack) return extraHints ?? EMPTY_HINTS;
    return [...(extraHints ?? []), BACK_HINT];
  }, [canGoBack, extraHints]);
  useScreenHints(hints);

  useScreenInput(
    (_input, key) => {
      if (key.escape) {
        store.goBack();
      }
    },
    { isActive: canGoBack },
  );
}
