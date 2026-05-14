/**
 * outro-last-activity — pure helper that formats a "Last activity / Step"
 * affordance for the error outro.
 *
 * Why a separate helper: when a run dies, the user is staring at a wall of
 * suggested next-steps ("Press L to open the log", "--debug for more
 * detail", "Press C to write a bug report"). Without a concrete anchor for
 * *where* the run was when it failed, the log file is a haystack — they
 * have to scroll back through dozens of progress messages to find the
 * point of failure. The session already tracks both the active task (via
 * `store.tasks` derived from agent TodoWrite) and `runStartedAt`. We
 * surface them together on the error outro so the user has a one-glance
 * "right, the install step blew up around 14:23" mental model before
 * they open the log.
 *
 * Pure and `now`-parameterised so the line is deterministic in snapshot
 * tests — no `Date.now()` inside the renderer.
 */

import type { TaskItem } from '../store.js';
import { TaskStatus } from '../../wizard-ui.js';

export interface LastActivityFooter {
  /** Wall-clock time the run started, formatted "HH:MM:SS". */
  startedAt: string;
  /** User-visible label of the active task (or last-completed if none active). */
  stepLabel: string;
}

/**
 * Format a 24h HH:MM:SS clock from an absolute timestamp. Locale-agnostic
 * (no AM/PM shimmer between machines) and zero-padded so the column
 * doesn't jitter as the run crosses single-digit hour boundaries.
 *
 * Exported for tests so the format contract is verifiable independently
 * of the surrounding helper.
 */
export function formatClockTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Build the "Last activity / Step" footer for the error outro.
 *
 * Returns `null` when there's nothing useful to show — either the run
 * never started (no `runStartedAt`) or no task ever transitioned past
 * `pending`. In those cases the existing troubleshooting bullets are
 * already enough; we'd rather render nothing than a confusing
 * `Step: <empty>` line.
 *
 * Step resolution:
 *   1. Most-recent `InProgress` task wins — that's where the agent was
 *      when it died.
 *   2. Fall through to the most-recent `Completed` task — "we got
 *      through install but failed before reaching plan".
 *   3. If everything is `Pending`, return null (no signal yet).
 */
export function buildLastActivityFooter(input: {
  runStartedAt: number | null;
  tasks: readonly TaskItem[];
}): LastActivityFooter | null {
  const { runStartedAt, tasks } = input;
  if (runStartedAt === null) return null;

  // Walk from the tail so the *latest* in_progress / completed wins
  // regardless of how many earlier tasks share the status.
  let activeLabel: string | null = null;
  let lastCompletedLabel: string | null = null;
  for (let i = tasks.length - 1; i >= 0; i--) {
    const t = tasks[i];
    if (t.status === TaskStatus.InProgress && activeLabel === null) {
      activeLabel = t.label;
      // In-progress beats completed — short-circuit.
      break;
    }
    if (t.status === TaskStatus.Completed && lastCompletedLabel === null) {
      lastCompletedLabel = t.label;
      // Keep walking — an in_progress later in the tail (unlikely with
      // the sequential cascade, but defensive) should still win.
    }
  }

  const stepLabel = activeLabel ?? lastCompletedLabel;
  if (stepLabel === null) return null;

  return {
    startedAt: formatClockTime(runStartedAt),
    stepLabel,
  };
}
