/**
 * One-shot bridge so non-React code (the store's emitChange) can force
 * Ink to re-render. We set this from start-tui's render() boot path
 * because the Ink Instance isn't otherwise reachable from the store
 * without dependency-cycling start-tui ← store. Plain function pointer
 * is the smallest viable surface; null when no TUI is mounted (agent
 * mode / CI mode / tests) so the call is a no-op.
 *
 * Why we need this: Ink's internal log-update can silently skip writes
 * when its diff cache thinks the new frame matches the previous one,
 * so state changes that produce visually different trees were getting
 * dropped until a manual terminal resize forced a clearTerminal+repaint.
 * `Ink.Instance.rerender()` re-evaluates the React tree from scratch
 * AND triggers Ink's renderer to invalidate its frame cache, bypassing
 * the diff-skip path.
 */

let rerender: (() => void) | null = null;

export function setRerender(fn: (() => void) | null): void {
  rerender = fn;
}

export function triggerRerender(): void {
  if (rerender) {
    try {
      rerender();
    } catch {
      // Best-effort — never let a render hiccup crash the run.
    }
  }
}
