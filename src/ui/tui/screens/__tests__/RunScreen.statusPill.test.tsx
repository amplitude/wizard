/**
 * RunScreen — bottom status pill no longer echoes the active canonical
 * task's `activeForm`.
 *
 * History:
 *   PR #663 anchored the pill to the canonical task `activeForm`
 *   (instead of the trailing free-form `pushStatus`), fixing the
 *   "agent says 'let me plan…' after Plan ✓" mismatch.
 *
 *   PR #685 hardened tier 6 to walk `CANONICAL_STEPS` in order and
 *   short-circuit on the first in_progress row, fixing the "pill says
 *   'Detecting your project setup' while plan is in_progress" bug.
 *
 *   PR #688 made the pill flush with the content area (sitting directly
 *   under the Tasks list). Tier 6's contract suddenly produced visible
 *   duplicates: ProgressList shows `› Detecting project setup` as the
 *   in-progress row, and the pill below shows `◇ Detecting project
 *   setup` — the same string twice.
 *
 * Fix:
 *   `run-status-pill.ts` now suppresses tier 6 entirely and ALSO skips
 *   tier 7 while a canonical task is in_progress (otherwise stale
 *   pushStatus narration would leak in). Higher-priority tiers (file
 *   writes, tool activity, event-plan-await, currentActivity,
 *   postAgentSteps) keep firing because their messages carry signal
 *   the Tasks list does NOT already display.
 *
 *   These tests are integration-shaped: they exercise the
 *   `resolveRunScreenStatus` wrapper that `RunScreen.tsx` re-exports,
 *   pinning the contract callers see.
 */

import { describe, it, expect } from 'vitest';

import { resolveRunScreenStatus } from '../RunScreen.js';
import { makeStoreForSnapshot } from '../../__tests__/snapshot-utils.js';
import { TaskStatus } from '../../../wizard-ui.js';
import { PostAgentStepStatus } from '../../session-constants.js';
import { CANONICAL_STEPS } from '../../../../lib/canonical-tasks.js';

function makeCanonicalTasks(opts: {
  /** Index of the in-progress task (others are completed before, pending after). */
  inProgressIndex: number;
  /** Override for the in-progress task's activeForm. */
  inProgressActiveForm?: string;
}) {
  return CANONICAL_STEPS.map((step, i) => {
    let status: TaskStatus;
    if (i < opts.inProgressIndex) status = TaskStatus.Completed;
    else if (i === opts.inProgressIndex) status = TaskStatus.InProgress;
    else status = TaskStatus.Pending;
    return {
      label: step.label,
      activeForm:
        i === opts.inProgressIndex && opts.inProgressActiveForm
          ? opts.inProgressActiveForm
          : step.defaultActiveForm,
      status,
      done: status === TaskStatus.Completed,
    };
  });
}

describe('resolveRunScreenStatus — duplicate-pill suppression contract', () => {
  it('returns undefined when only signal is an in-progress canonical task (Tasks list already shows it)', () => {
    // Bug from a real user screenshot: the Tasks list correctly showed
    // detect ✓, install ✓, plan in_progress, wire pending — and the
    // pill below the list ALSO showed plan's activeForm, the same string
    // twice. With the suppression in place the pill is omitted.
    const store = makeStoreForSnapshot();
    store.setTasks(
      makeCanonicalTasks({
        inProgressIndex: 3, // wire
      }),
    );
    expect(resolveRunScreenStatus(store)).toBeUndefined();
  });

  it('returns undefined even when stale narration would have echoed (no leak through tier 7)', () => {
    // Tier 6 is suppressed, but tier 7 (`pushStatus` cold-start fallback)
    // must ALSO not fire while a canonical task is running — otherwise
    // stale streamed narration ("now let me plan…") would leak into the
    // pill mid-run, the very bug PR #663 fixed.
    const store = makeStoreForSnapshot();
    store.setTasks(
      makeCanonicalTasks({
        inProgressIndex: 3, // wire
      }),
    );
    store.pushStatus('Detected Next.js 15 with the App Router');
    store.pushStatus(
      "age install finished. Now let me plan the events based on what I've read",
    );
    expect(resolveRunScreenStatus(store)).toBeUndefined();
  });

  it('returns the trailing statusMessage when no canonical task is in_progress (cold-start)', () => {
    // Before the first journey transition lands, $tasks is empty (or
    // all-pending). The streamed narration is the only signal we have,
    // so the pill should still surface it — that's the cold-start UX
    // the inline header line was added for.
    const store = makeStoreForSnapshot();
    expect(store.tasks.length).toBe(0);
    store.pushStatus('Reading package.json');

    expect(resolveRunScreenStatus(store)).toBe('Reading package.json');
  });

  it('returns undefined when neither canonical task nor statusMessage exists', () => {
    const store = makeStoreForSnapshot();
    expect(resolveRunScreenStatus(store)).toBeUndefined();
  });

  it('post-agent step activeForm wins over canonical task suppression', () => {
    // Existing contract pinned by the FinalizingPanel — the post-agent
    // step is the source of truth once the in-loop agent has handed off,
    // and it is NOT shown in the Tasks list (it's a separate panel), so
    // it does NOT duplicate. Suppression must scope to tier 6 only.
    const store = makeStoreForSnapshot();
    store.setTasks(
      makeCanonicalTasks({
        inProgressIndex: 3, // wire
      }),
    );
    store.pushStatus('Some streaming narration');
    store.session = {
      ...store.session,
      postAgentSteps: [
        {
          id: 'create-dashboard',
          label: 'Create your starter dashboard',
          activeForm: 'Creating your starter dashboard',
          status: PostAgentStepStatus.InProgress,
        },
      ],
    };

    expect(resolveRunScreenStatus(store)).toBe(
      'Creating your starter dashboard',
    );
  });

  it('falls back to trailing statusMessage when only completed canonical tasks exist', () => {
    // After every canonical step has flipped to ✓ but the post-agent
    // queue has not yet been seeded, no canonical task is in_progress
    // and there is no post-agent step either. The trailing narration is
    // the right fallback — no canonical row is currently rendered as
    // in_progress in the Tasks list, so there is nothing to duplicate.
    const store = makeStoreForSnapshot();
    store.setTasks(
      CANONICAL_STEPS.map((step) => ({
        label: step.label,
        activeForm: step.defaultActiveForm,
        status: TaskStatus.Completed,
        done: true,
      })),
    );
    store.pushStatus('Wrapping up');
    expect(resolveRunScreenStatus(store)).toBe('Wrapping up');
  });

  // Regression contract — tier 6 is suppressed, but the resolver must
  // not over-suppress: any of the higher-priority tiers (1-5) carry
  // signal the Tasks list does NOT show, so they must keep firing even
  // when a canonical task is in_progress.

  it('plan in_progress with a custom activeForm: pill is still suppressed (tier 6)', () => {
    const store = makeStoreForSnapshot();
    store.setTasks(
      makeCanonicalTasks({
        inProgressIndex: 2, // plan
        inProgressActiveForm: 'Reading event plan…',
      }),
    );
    expect(resolveRunScreenStatus(store)).toBeUndefined();
  });

  it('plan in_progress with no activeForm: pill is still suppressed (tier 6)', () => {
    // Same journey state but the agent never emitted a TodoWrite
    // activeForm for plan. The Tasks list shows the canonical label as
    // its in-progress row, so suppression still applies.
    const store = makeStoreForSnapshot();
    store.setTasks([
      {
        label: CANONICAL_STEPS[0].label,
        activeForm: undefined,
        status: TaskStatus.Completed,
        done: true,
      },
      {
        label: CANONICAL_STEPS[1].label,
        activeForm: undefined,
        status: TaskStatus.Completed,
        done: true,
      },
      {
        label: CANONICAL_STEPS[2].label,
        activeForm: undefined,
        status: TaskStatus.InProgress,
        done: false,
      },
      {
        label: CANONICAL_STEPS[3].label,
        activeForm: undefined,
        status: TaskStatus.Pending,
        done: false,
      },
    ]);
    expect(resolveRunScreenStatus(store)).toBeUndefined();
  });

  it('updates as journey state advances: Plan in_progress -> Wire in_progress (both suppressed)', () => {
    // Simulates the live progression. Tier 6 is suppressed throughout —
    // the Tasks list in the rendered view above the pill is what the
    // user is reading, not a duplicated pill.
    const store = makeStoreForSnapshot();

    // Phase 1: Plan in progress with custom activeForm from a TodoWrite.
    store.setTasks(
      makeCanonicalTasks({
        inProgressIndex: 2, // plan
        inProgressActiveForm: 'Planning events for an e-commerce app',
      }),
    );
    store.pushStatus('Reading skill files');
    expect(resolveRunScreenStatus(store)).toBeUndefined();

    // Phase 2: streaming narration lands but before the journey advances.
    // The pill is still suppressed — the canonical task's activeForm is
    // still showing in the Tasks list above.
    store.pushStatus("Now let me plan the events based on what I've read");
    expect(resolveRunScreenStatus(store)).toBeUndefined();

    // Phase 3: classifier flips Plan to ✓ and Wire to in_progress. The
    // pill still doesn't fire — Wire's activeForm is now what the Tasks
    // list shows.
    store.setTasks(
      makeCanonicalTasks({
        inProgressIndex: 3, // wire
      }),
    );
    expect(resolveRunScreenStatus(store)).toBeUndefined();
  });
});
