/**
 * Task lifecycle — explicit state enum and transition validator.
 *
 * The wizard has had implicit task lifecycle scattered across boolean fields
 * (`done`, `error`) for a while; v2 makes it explicit so:
 *   - the store can validate transitions at write time (illegal transitions
 *     throw with a helpful message instead of producing a corrupt row);
 *   - `last-stopping-point` can derive accurate "active" / "blocked" / etc.
 *     groups without re-deriving from booleans;
 *   - external orchestrators get a stable, documented set of states to
 *     branch on.
 */

/** All valid lifecycle states for an orchestration `Task`. */
export const TaskLifecycle = {
  /** Task created, awaiting start. */
  Queued: 'queued',
  /** Task is actively executing. */
  Running: 'running',
  /** Task is paused on a user checkpoint (event-plan confirm, MCP, etc.). */
  WaitingForUser: 'waiting_for_user',
  /** Task cannot proceed — auth, network, missing dependency. */
  Blocked: 'blocked',
  /** Terminal: success. */
  Completed: 'completed',
  /** Terminal: failure. */
  Failed: 'failed',
  /** Terminal: cancelled by the user. */
  Cancelled: 'cancelled',
  /** Terminal: replaced by another task; reference via `task.supersededBy`. */
  Superseded: 'superseded',
} as const;
export type TaskLifecycle = (typeof TaskLifecycle)[keyof typeof TaskLifecycle];

const TERMINAL_STATES = new Set<TaskLifecycle>([
  TaskLifecycle.Completed,
  TaskLifecycle.Failed,
  TaskLifecycle.Cancelled,
  TaskLifecycle.Superseded,
]);

/** True iff `state` is a terminal lifecycle state (no outbound transitions). */
export function isTerminal(state: TaskLifecycle): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Allowed transitions, expressed as a (from -> Set<to>) map.
 *
 *   queued           → running, cancelled, superseded
 *   running          → waiting_for_user, blocked, completed, failed,
 *                      cancelled, superseded
 *   waiting_for_user → running, completed, failed, cancelled, superseded
 *   blocked          → running, failed, cancelled, superseded
 *
 * Any non-terminal state can transition to `superseded` (another task
 * replaced it). Terminal states have no outbound transitions.
 *
 * `superseded` is included in many right-hand sides because the wizard does
 * supersede tasks across phases (e.g. retry produces a new task; the prior
 * one is marked superseded regardless of where it stopped).
 */
const ALLOWED_TRANSITIONS: ReadonlyMap<
  TaskLifecycle,
  ReadonlySet<TaskLifecycle>
> = new Map<TaskLifecycle, ReadonlySet<TaskLifecycle>>([
  [
    TaskLifecycle.Queued,
    new Set<TaskLifecycle>([
      TaskLifecycle.Running,
      TaskLifecycle.Cancelled,
      TaskLifecycle.Superseded,
    ]),
  ],
  [
    TaskLifecycle.Running,
    new Set<TaskLifecycle>([
      TaskLifecycle.WaitingForUser,
      TaskLifecycle.Blocked,
      TaskLifecycle.Completed,
      TaskLifecycle.Failed,
      TaskLifecycle.Cancelled,
      TaskLifecycle.Superseded,
    ]),
  ],
  [
    TaskLifecycle.WaitingForUser,
    new Set<TaskLifecycle>([
      TaskLifecycle.Running,
      TaskLifecycle.Completed,
      TaskLifecycle.Failed,
      TaskLifecycle.Cancelled,
      TaskLifecycle.Superseded,
    ]),
  ],
  [
    TaskLifecycle.Blocked,
    new Set<TaskLifecycle>([
      TaskLifecycle.Running,
      TaskLifecycle.Failed,
      TaskLifecycle.Cancelled,
      TaskLifecycle.Superseded,
    ]),
  ],
]);

/**
 * Returns true iff `from -> to` is a permitted transition.
 *
 * Identity transitions (`from === to`) are NOT permitted by default — the
 * caller should only invoke `transitionTask` when state actually changes.
 * Same-state writes go through a separate update path.
 */
export function canTransition(from: TaskLifecycle, to: TaskLifecycle): boolean {
  if (from === to) return false;
  if (isTerminal(from)) return false;
  const allowed = ALLOWED_TRANSITIONS.get(from);
  return allowed?.has(to) ?? false;
}

export class IllegalTaskTransitionError extends Error {
  readonly taskId: string;
  readonly from: TaskLifecycle;
  readonly to: TaskLifecycle;

  constructor(taskId: string, from: TaskLifecycle, to: TaskLifecycle) {
    const reason = isTerminal(from)
      ? `Task ${taskId} is already terminal in state '${from}' — terminal tasks cannot transition.`
      : `Task ${taskId} cannot transition from '${from}' to '${to}' — not in the allowed transition set.`;
    super(reason);
    this.name = 'IllegalTaskTransitionError';
    this.taskId = taskId;
    this.from = from;
    this.to = to;
  }
}

/**
 * Throw `IllegalTaskTransitionError` if `from -> to` is not allowed. Pure
 * helper that the store invokes before mutating; tests use it directly.
 */
export function assertTransition(
  taskId: string,
  from: TaskLifecycle,
  to: TaskLifecycle,
): void {
  if (!canTransition(from, to)) {
    throw new IllegalTaskTransitionError(taskId, from, to);
  }
}

/**
 * The set of states considered "active" for last-stopping-point grouping.
 * Pulled out so the LSP derivation and the store's introspection helpers
 * agree on the same definition.
 */
export const ACTIVE_STATES: ReadonlySet<TaskLifecycle> = new Set([
  TaskLifecycle.Running,
  TaskLifecycle.WaitingForUser,
  TaskLifecycle.Blocked,
]);

/** True iff `state` is one of the active grouping states above. */
export function isActive(state: TaskLifecycle): boolean {
  return ACTIVE_STATES.has(state);
}
