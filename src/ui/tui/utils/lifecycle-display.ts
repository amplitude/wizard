/**
 * lifecycle-display.ts — shared mapping from durable orchestration state
 * to TUI glyph + color + label.
 *
 * Part of v2 PR 5 (TUI redesign). Every primary surface — JourneyStepper,
 * ProgressList rows, the operator overview, choice banners, verification
 * ribbon, MCP-capability rows — draws from the same vocabulary so the
 * user learns it once. Centralizing the mapping here means a future
 * "I want to swap ⏸ for ⌛" change is a one-line edit, not a hunt across
 * the screen tree.
 *
 * Pure (no React, no store). The TUI imports `lifecycleDisplay(state)`;
 * test fixtures use it the same way.
 */
import {
  isTerminal,
  TaskLifecycle,
} from '../../../lib/orchestration/lifecycle.js';
import {
  Colors,
  LifecycleGlyph,
  LifecycleLabel,
  type LifecycleStateKey,
} from '../styles.js';

export interface LifecycleDisplay {
  /** Single-character glyph rendered in the gutter column. */
  glyph: string;
  /** Color token for the glyph + (optionally) the row text. */
  color: string;
  /** Short human label rendered beside the glyph. */
  label: string;
  /** True iff this state is "active" (running / waiting / blocked). */
  active: boolean;
  /** True iff this state is terminal (no outbound transitions). */
  terminal: boolean;
}

const STATE_TO_KEY: Record<TaskLifecycle, LifecycleStateKey> = {
  [TaskLifecycle.Queued]: 'queued',
  [TaskLifecycle.Running]: 'running',
  [TaskLifecycle.WaitingForUser]: 'waiting',
  [TaskLifecycle.Blocked]: 'blocked',
  [TaskLifecycle.Completed]: 'completed',
  [TaskLifecycle.Failed]: 'failed',
  [TaskLifecycle.Cancelled]: 'cancelled',
  [TaskLifecycle.Superseded]: 'superseded',
};

const COLOR_FOR_KEY: Record<LifecycleStateKey, string> = {
  queued: Colors.muted,
  running: Colors.active,
  waiting: Colors.accent,
  blocked: Colors.error,
  completed: Colors.success,
  failed: Colors.error,
  cancelled: Colors.warning,
  superseded: Colors.muted,
};

/**
 * Resolve the glyph + color + label for a durable lifecycle state.
 *
 * Falls back to `queued` styling for unknown values so an out-of-band
 * payload (e.g. a future state added in PR N+1, read by an older
 * wizard) renders as muted "Queued" rather than throwing.
 */
export function lifecycleDisplay(state: TaskLifecycle): LifecycleDisplay {
  const key = STATE_TO_KEY[state] ?? 'queued';
  return {
    glyph: LifecycleGlyph[key],
    color: COLOR_FOR_KEY[key],
    label: LifecycleLabel[key],
    active: key === 'running' || key === 'waiting' || key === 'blocked',
    terminal: isTerminal(state),
  };
}

/**
 * Lighter helper for callsites that already track their own coarser
 * status — currently `pending | in_progress | completed` from the
 * `ProgressItem` primitive. Maps onto the same vocabulary so a
 * pending row in ProgressList renders the same `○` as a `Queued`
 * orchestration task.
 */
export function progressDisplay(
  status: 'pending' | 'in_progress' | 'completed' | 'failed',
): LifecycleDisplay {
  const key: LifecycleStateKey =
    status === 'pending'
      ? 'queued'
      : status === 'in_progress'
      ? 'running'
      : status === 'failed'
      ? 'failed'
      : 'completed';
  return {
    glyph: LifecycleGlyph[key],
    color: COLOR_FOR_KEY[key],
    label: LifecycleLabel[key],
    active: key === 'running',
    terminal: key === 'completed' || key === 'failed',
  };
}
