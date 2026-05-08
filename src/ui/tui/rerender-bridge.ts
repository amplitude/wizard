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
 *
 * Why we DEFER + COALESCE: a synchronous `instance.rerender()` call from
 * inside `emitChange()` runs React's commit phase on the current call
 * stack. If any subscriber (`useSyncExternalStore`) reads state that
 * triggers another store mutation — or any logger.warn → pushStatus path
 * fires during commit — we re-enter `emitChange` → `triggerRerender` →
 * React commit → ... and React aborts with "Maximum update depth
 * exceeded". By scheduling on a microtask we let the current call stack
 * unwind first, and by coalescing pending calls we collapse a burst of
 * mutations into a single rerender. Ink's diff cache still gets
 * invalidated — just one tick later — so the original frame-stuck fix
 * (#656) still works.
 */

let rerender: (() => void) | null = null;
let pending = false;

export function setRerender(fn: (() => void) | null): void {
  rerender = fn;
  // Reset coalescing state on (re)attach so a stale pending flag from a
  // prior mount can't suppress the first rerender after re-mount in
  // tests or hot-reload paths.
  pending = false;
}

export function triggerRerender(): void {
  if (!rerender || pending) return;
  pending = true;
  queueMicrotask(() => {
    pending = false;
    const fn = rerender;
    if (!fn) return;
    try {
      fn();
    } catch {
      // Best-effort — never let a render hiccup crash the run.
    }
  });
}
