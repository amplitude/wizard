/**
 * agentInterrupt — Synthetic pause stub for the Tab-to-ask flow.
 *
 * This is the TUI-side half of the killer Tab-to-ask interaction (Timeline
 * UX PR 6). The user taps Tab on RunScreen, AskBar opens, they type a
 * question, hit Enter, and the wizard renders a synchronous "got it,
 * pausing to look at that" ack line in the timeline. That synchronous ack
 * is what meets the 500ms-acknowledgement contract — it is rendered in the
 * same React render tick as the Enter submission, with no setTimeout /
 * microtask gap.
 *
 * What this module actually does **right now**:
 *
 *   - `interrupt()`   — flip `paused = true` and notify subscribers.
 *   - `inject(msg)`   — queue a user-injected message (FIFO).
 *   - `resume()`      — flip `paused = false` and notify subscribers.
 *   - `getState()`    — snapshot (paused, pending queue length).
 *   - `subscribe(fn)` — minimal observer for tests + the eventual SDK
 *                       wiring.
 *
 * What this module does **NOT** do yet:
 *
 *   - Hook into the Claude Agent SDK's tool-use emission so the agent
 *     actually pauses. The Agent SDK currently exposes
 *     PreToolUse / PostToolUse / Stop hooks, but no synchronous "wait
 *     here until I tell you to resume" surface. Building one without an
 *     SDK contract would either:
 *       (a) race with the agent's existing stop / abort flow, or
 *       (b) require swallowing tool-use events in the wizard's hook
 *           layer, which means tool calls would silently disappear from
 *           the user's view.
 *     Both options are worse than the synthetic ack. The follow-up PR
 *     will land once we have a public pause/resume hook on the SDK side
 *     (or a clear extension point in `src/lib/agent-interface.ts`). The
 *     wiring then comes down to:
 *       1. `subscribe()` in `agent-interface.ts` and await `resume()`
 *          before invoking the next tool when `paused === true`.
 *       2. Drain `drainPendingInjections()` into the agent's next user
 *          message (prepended to whatever the runner was about to send).
 *
 * Module state lives in this file deliberately — there is exactly one
 * agent run per wizard process, so a singleton is the simplest shape that
 * survives React's render lifecycle. Tests can call `__resetForTests()`
 * between cases to reset state.
 */

interface InterruptState {
  paused: boolean;
  /** FIFO of user-injected messages awaiting drain by the agent runner. */
  pending: readonly string[];
}

type Listener = (state: InterruptState) => void;

let _state: InterruptState = { paused: false, pending: [] };
const _listeners = new Set<Listener>();

function notify(): void {
  // Iterate over a snapshot — a listener that unsubscribes itself
  // during the callback must not corrupt the iteration order.
  for (const fn of [..._listeners]) {
    try {
      fn(_state);
    } catch {
      // Subscribers are tests / future SDK glue; never let a misbehaving
      // listener take down the wizard render path.
    }
  }
}

/**
 * Snapshot of the current interrupt state. Returned object is a fresh
 * frozen copy on every call so the caller can't mutate module state.
 */
export function getState(): InterruptState {
  return Object.freeze({ paused: _state.paused, pending: _state.pending });
}

/**
 * Flip `paused = true`. No-op if already paused — subscribers only see
 * one notification per visible state transition.
 */
export function interrupt(): void {
  if (_state.paused) return;
  _state = { ..._state, paused: true };
  notify();
}

/**
 * Queue a user-injected message. The trimmed value is appended to the
 * pending FIFO. Empty / whitespace-only input is dropped silently — the
 * AskBar already trims before calling, this is belt-and-braces.
 *
 * Returns the trimmed value that was queued, or `null` if the input was
 * empty and nothing was queued. Concurrent `inject()` calls preserve
 * insertion order — see the test suite.
 */
export function inject(message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed) return null;
  _state = { ..._state, pending: [..._state.pending, trimmed] };
  notify();
  return trimmed;
}

/**
 * Flip `paused = false` and (intentionally) leave the pending queue
 * alone. The eventual SDK integration drains the queue via
 * `drainPendingInjections()` when it routes the user-injected messages
 * into the next agent turn — clearing them here would orphan unsent
 * questions if `resume()` raced ahead of the drain.
 */
export function resume(): void {
  if (!_state.paused) return;
  _state = { ..._state, paused: false };
  notify();
}

/**
 * Pull every pending message out of the queue and return them in
 * insertion order. After this call, `getState().pending` is empty.
 *
 * Reserved for the agent runner — the UI layer should not call this.
 * Exported now so the eventual `agent-interface.ts` wiring can land in
 * a follow-up PR without changing this module's shape.
 */
export function drainPendingInjections(): readonly string[] {
  if (_state.pending.length === 0) return [];
  const drained = _state.pending;
  _state = { ..._state, pending: [] };
  notify();
  return drained;
}

/**
 * Subscribe to state transitions. Returns an unsubscribe function. The
 * callback fires synchronously on every `interrupt()`, `inject()`,
 * `resume()`, or `drainPendingInjections()` that changes observable
 * state.
 */
export function subscribe(listener: Listener): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

/**
 * Reset module state. Test-only — keeps the suite isolated since the
 * module-state singleton would otherwise leak across `describe` blocks.
 * The leading double-underscore is intentional: this is not part of the
 * public surface and the convention should make it obvious at call
 * sites that a production caller is doing something wrong.
 */
export function __resetForTests(): void {
  _state = { paused: false, pending: [] };
  _listeners.clear();
}
