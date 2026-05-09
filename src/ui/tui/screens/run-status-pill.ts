/**
 * run-status-pill — resolve the bottom-pill text for `RunScreen`.
 *
 * The original `resolveRunScreenStatus` returned the canonical step's
 * `activeForm` (e.g. "Wiring up event tracking") whenever a journey task
 * was in_progress. That fixed the state/narration mismatch reported in
 * #646 but it traded one problem for another: the pill became boring.
 * Users see the same canonical sentence in the Tasks list above and
 * (sometimes) in the journey stepper — repeating it in the bottom bar
 * is a wasted line.
 *
 * This module replaces the canonical step's `activeForm` with the most
 * SPECIFIC content the wizard already has at hand. The store carries
 * plenty of richer signal (file writes, tool activities, retry status,
 * compaction state, event-plan size) — we just have to surface it.
 *
 * Priority (highest wins). Each tier is short-circuit; if it returns a
 * non-empty string, lower tiers are not consulted.
 *
 *   1. Active **post-agent** step's `activeForm` — single source of
 *      truth during the FinalizingPanel phase (charts / dashboard /
 *      commit). Untouched from the original contract.
 *
 *   2. **Compaction / retry / cold-start activity** — `currentActivity`
 *      is set whenever the wizard is mid-stall (PreCompact hook, retry
 *      sleep, ingestion poll, etc.). When it's set the pill shows that
 *      message. This is the highest-priority "what's happening now"
 *      signal and beats the canonical task name.
 *
 *   3. **Awaiting user sign-off on the event plan.** When the wizard
 *      has pushed an `event-plan` pendingPrompt (the EventPlanScreen is
 *      modally awaiting Y/N), the pill says "N events approved · awaiting
 *      your sign-off" — concrete and actionable.
 *
 *   4. **Recent file write** (planned/applied) — within the last few
 *      seconds, render "Editing src/foo.ts" or "✓ Wrote src/bar.ts".
 *      Specific to the file the agent has its hands on RIGHT NOW. Falls
 *      through after a short window so a stale file path doesn't pin the
 *      pill while the agent is doing other things.
 *
 *   5. **Recent tool activity** — same idea, slightly less specific:
 *      "Reading package.json", "Running pnpm add @amplitude/…". The
 *      `toolActivities` buffer is already verb-formatted by
 *      `formatToolCallLabel`, so we just take the most recent entry.
 *      Same staleness window as tier 4.
 *
 *   6. **Active canonical task's `activeForm`** — the original behavior.
 *      Used when none of the live signals above are recent. Implemented
 *      by walking `CANONICAL_STEPS` in order and short-circuiting on the
 *      first in_progress row, NOT `tasks.find(InProgress)`. The latter
 *      mislabels the pill with `detect`'s text whenever two rows are
 *      ever in_progress at once. Defensive fallback: same step's
 *      canonical label, never another step's text.
 *
 *   7. **Trailing free-form `pushStatus` line** — cold-start fallback,
 *      before any task has flipped to in_progress.
 *
 * The cap (`STATUS_MAX_LEN`) is enforced by the caller in `RunScreen`,
 * not here — this module only computes the message.
 */

import { TaskStatus } from '../../wizard-ui.js';
import { PostAgentStepStatus } from '../session-constants.js';
import type { WizardStore } from '../store.js';
import { CANONICAL_STEPS } from '../../../lib/canonical-tasks.js';
import path from 'node:path';

/**
 * Window after a tool/file event during which the pill considers it "live"
 * and shows it. After this window we fall through to lower tiers so a
 * stale file path doesn't pin the bar while the agent moves on. 3s matches
 * the substep panel's natural cadence — fast enough to feel responsive,
 * slow enough that single-shot tool calls (Read, Bash) still register.
 */
const ACTIVITY_FRESHNESS_MS = 3000;

/**
 * Relativize an absolute path against installDir. Mirrors `shortPath` from
 * `tool-call-label.ts` but inlined here so this module stays self-contained
 * (and so we control behavior when the file lies outside the install dir,
 * which the substep formatter has already normalized).
 */
function shortFilePath(raw: string, installDir?: string): string {
  if (!raw) return raw;
  if (
    installDir &&
    raw.startsWith(installDir) &&
    (raw.length === installDir.length ||
      raw[installDir.length] === '/' ||
      raw[installDir.length] === '\\')
  ) {
    const rel = path.relative(installDir, raw);
    return rel === '' ? path.basename(raw) : rel;
  }
  if (raw.startsWith('/') && raw.length > 40) return path.basename(raw);
  return raw;
}

/**
 * Format a single `FileWriteEntry` as a concrete pill message.
 *
 *   planned + create  → "Creating src/lib/foo.ts"
 *   planned + modify  → "Editing src/lib/foo.ts"
 *   applied + create  → "✓ Created src/lib/foo.ts"
 *   applied + modify  → "✓ Wrote src/lib/foo.ts"
 *   failed            → "✗ Failed src/lib/foo.ts"
 *
 * The "✓" / "✗" prefix differentiates "in flight" from "just landed" at
 * a glance — same convention used by the FileWritesPanel rows above.
 */
export function formatFileWriteForPill(
  entry: {
    path: string;
    operation: 'create' | 'modify' | 'delete';
    status: 'planned' | 'applied' | 'failed';
  },
  installDir?: string,
): string {
  const display = shortFilePath(entry.path, installDir);
  if (entry.status === 'failed') return `✗ Failed ${display}`;
  if (entry.status === 'applied') {
    if (entry.operation === 'delete') return `✓ Deleted ${display}`;
    if (entry.operation === 'create') return `✓ Created ${display}`;
    return `✓ Wrote ${display}`;
  }
  // planned
  if (entry.operation === 'delete') return `Deleting ${display}`;
  if (entry.operation === 'create') return `Creating ${display}`;
  return `Editing ${display}`;
}

/**
 * Resolve the bottom pill message. See module docstring for tiers.
 *
 * `now` is injected so tests can pin the freshness window deterministically.
 * Production callers omit it (defaults to `Date.now()`).
 */
export function resolveRunStatusPill(
  store: WizardStore,
  now: number = Date.now(),
): string | undefined {
  // Tier 1 — post-agent step (FinalizingPanel phase).
  const activePostAgentStep = store.session.postAgentSteps.find(
    (s) => s.status === PostAgentStepStatus.InProgress,
  );
  if (activePostAgentStep?.activeForm) return activePostAgentStep.activeForm;

  // Tier 2 — compaction / retry / cold-start / ingestion poll. These are
  // long stalls where the canonical task name lies ("Wiring up event
  // tracking" while context is compacting for 60s).
  const activity = store.session.currentActivity;
  if (activity && activity.message) return activity.message;

  // Tier 3 — modal event-plan prompt. Concrete and actionable.
  const prompt = store.pendingPrompt;
  if (prompt?.kind === 'event-plan') {
    const n = prompt.events.length;
    return `${n} event${n === 1 ? '' : 's'} planned · awaiting your sign-off`;
  }

  // Tier 4 — recent file write. The most-specific "what file are we
  // touching right now" signal. Within ACTIVITY_FRESHNESS_MS of either
  // planned (in-flight) or applied (just landed).
  const fileWrites = store.fileWrites;
  if (fileWrites.length > 0) {
    const last = fileWrites[fileWrites.length - 1];
    const ts = last.completedAt ?? last.startedAt;
    if (now - ts <= ACTIVITY_FRESHNESS_MS) {
      return formatFileWriteForPill(last, store.session.installDir);
    }
  }

  // Tier 5 — recent tool activity (Read/Bash/Grep/Glob/MCP). Already
  // verb-formatted by `formatToolCallLabel` upstream, so this is just a
  // pass-through with a staleness gate.
  const toolActivities = store.toolActivities;
  if (toolActivities.length > 0) {
    const last = toolActivities[toolActivities.length - 1];
    if (now - last.startedAt <= ACTIVITY_FRESHNESS_MS) {
      return last.label;
    }
  }

  // Tier 6 — canonical in-progress task's activeForm. The safe, boring
  // fallback when nothing more specific is fresh.
  //
  // Walk `CANONICAL_STEPS` in order and short-circuit on the first
  // in_progress row. Crucially, this is NOT `store.tasks.find(t =>
  // t.status === InProgress)`: if anything (mid-batch render, future
  // setter that bypasses the renderJourneyTasks frontier cascade) ever
  // leaves two rows as in_progress at the same time, `find` returns the
  // FIRST match — which would be `detect`, silently mislabelling the
  // pill with detect's text while the user visibly watches a later step
  // run. A user reported exactly this: pill read "Detecting your
  // project setup" while the task list correctly showed detect ✓,
  // install ✓, plan in_progress, wire pending. Walking CANONICAL_STEPS
  // in order — keyed by canonical step index, with `tasks[i]` paired
  // 1:1 with `CANONICAL_STEPS[i]` — anchors the pill to whichever step
  // is current. The defensive fallback to the SAME step's canonical
  // label (rather than `defaultActiveForm` of any other step) makes
  // sure that even if the agent never set an `activeForm` we surface
  // the SAME step's text, never a different step's.
  const tasks = store.tasks;
  for (let i = 0; i < CANONICAL_STEPS.length; i++) {
    const task = tasks[i];
    if (!task) continue;
    if (task.status !== TaskStatus.InProgress) continue;
    if (task.activeForm && task.activeForm.trim()) return task.activeForm;
    return CANONICAL_STEPS[i].label;
  }

  // Tier 7 — trailing free-form `pushStatus` line. Cold-start gap before
  // the first canonical task has flipped to in_progress.
  if (store.statusMessages.length > 0) {
    return store.statusMessages[store.statusMessages.length - 1];
  }
  return undefined;
}
