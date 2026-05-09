/**
 * RunScreen — bottom status pill prefers canonical task `activeForm`
 * over stale free-form `pushStatus` narration.
 *
 * Bug:
 *   Users saw the bottom diamond pill (`◇ ...`) say "Now let me plan
 *   the events" *while the Plan task was already marked ✓ and Wire was
 *   in_progress*. The pill was sourced from the trailing
 *   `store.statusMessages` entry, which gets fed by streaming text
 *   deltas (see `enqueueStreamDelta` in `agent-interface.ts`) and is
 *   never cleared on journey transitions — so a free-form sentence
 *   from the previous phase outranked the deterministic canonical
 *   state.
 *
 * Fix:
 *   `resolveRunScreenStatus` (in `RunScreen.tsx`) now prefers the
 *   in-progress canonical task's `activeForm` over the trailing
 *   `statusMessages` line. The trailing free-form line is only used
 *   when no canonical task is in_progress (cold-start gap, between
 *   steps).
 *
 * These tests pin the priority order so a future refactor of the
 * status-text resolution can't silently regress.
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

describe('resolveRunScreenStatus — state/narration mismatch fix', () => {
  it('returns the in-progress canonical task activeForm when one is active, ignoring stale narration', () => {
    // Reproduces the user-reported screenshot: Plan ✓, Wire in_progress,
    // but the agent's last streamed sentence is a stale "let me plan…".
    const store = makeStoreForSnapshot();
    store.setTasks(
      makeCanonicalTasks({
        inProgressIndex: 3, // wire
      }),
    );
    store.pushStatus('Detected Next.js 15 with the App Router');
    store.pushStatus(
      // The stale narration the user reported. The Plan step has already
      // flipped to ✓ via the journey classifier (PostToolUse on
      // confirm_event_plan), but the streamed text delta is still here.
      "age install finished. Now let me plan the events based on what I've read",
    );

    expect(resolveRunScreenStatus(store)).toBe('Wiring up event tracking');
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

  it('post-agent step activeForm wins over canonical task and trailing statusMessage', () => {
    // Existing contract pinned by the FinalizingPanel — the post-agent
    // step is the source of truth once the in-loop agent has handed off.
    // The fix did not loosen this; this test pins it.
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
    // and there is no post-agent step either. The trailing
    // narration is the right fallback.
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

  it('updates as journey state advances: Plan in_progress -> Wire in_progress', () => {
    // Simulates the live progression. Initially Plan is in_progress and
    // its activeForm is what the pill shows; then the classifier flips
    // Plan to ✓ and Wire to in_progress, and the pill follows the
    // canonical state — never the leftover narration.
    const store = makeStoreForSnapshot();

    // Phase 1: Plan in progress with custom activeForm from a TodoWrite.
    store.setTasks(
      makeCanonicalTasks({
        inProgressIndex: 2, // plan
        inProgressActiveForm: 'Planning events for an e-commerce app',
      }),
    );
    store.pushStatus('Reading skill files');
    expect(resolveRunScreenStatus(store)).toBe(
      'Planning events for an e-commerce app',
    );

    // Phase 2: streaming narration lands ("now let me plan…") but
    // before the journey advances. Pill stays anchored to the canonical
    // active task — narration cannot beat canonical state.
    store.pushStatus("Now let me plan the events based on what I've read");
    expect(resolveRunScreenStatus(store)).toBe(
      'Planning events for an e-commerce app',
    );

    // Phase 3: classifier flips Plan to ✓ and Wire to in_progress
    // (PostToolUse on confirm_event_plan + first Edit afterwards). The
    // stale "now let me plan…" narration is still the last entry in
    // statusMessages, but the pill now follows Wire.
    store.setTasks(
      makeCanonicalTasks({
        inProgressIndex: 3, // wire
      }),
    );
    expect(resolveRunScreenStatus(store)).toBe('Wiring up event tracking');
  });
});
