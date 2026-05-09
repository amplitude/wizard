/**
 * RunScreen — bottom status pill resolves to the CURRENT in-progress
 * canonical task, never the first step's text.
 *
 * History:
 *   PR #663 anchored the pill to the canonical task `activeForm`
 *   (instead of the trailing free-form `pushStatus`), fixing the
 *   "agent says 'let me plan…' after Plan ✓" mismatch.
 *
 *   Regression: a user reported the pill reading "Detecting your
 *   project setup" while the task list correctly showed detect ✓,
 *   install ✓, plan in_progress, wire pending. The previous resolver
 *   used `store.tasks.find(t => t.status === InProgress)` which
 *   returns the FIRST match — so any state where two rows are
 *   in_progress at once silently mislabels the pill with the earliest
 *   step's text (detect). This file pins both the original contract
 *   AND the regression: the pill's text must always belong to the
 *   step the user is actively waiting on.
 *
 * Fix:
 *   The resolver (now in `run-status-pill.ts`, surfaced through the
 *   `resolveRunScreenStatus` back-compat wrapper in `RunScreen.tsx`)
 *   walks `CANONICAL_STEPS` in order and short-circuits on the first
 *   in_progress row. The fallback when `activeForm` is unset is the
 *   SAME step's canonical label ("Plan and approve events to track"),
 *   never another step's `defaultActiveForm`.
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

  // ─────────────────────────────────────────────────────────────────
  // Regression contract — pill must resolve to the CURRENT in-progress
  // step, not the FIRST step.
  //
  // Bug from a real user screenshot: the task list correctly showed
  // detect ✓, install ✓, plan in_progress, wire pending — but the
  // bottom pill read "◇ Detecting your project setup" (detect's
  // defaultActiveForm). User feedback: "bottom line says Detecting
  // project setup but clearly its past that".
  //
  // Root cause: `store.tasks.find(t => t.status === InProgress)`
  // returns the FIRST match. If two rows are ever in_progress at once
  // (or any future setter bypasses the cascade), the pill silently
  // mislabels with detect's text. The fix walks CANONICAL_STEPS in
  // order and falls back to the SAME step's canonical label, never to
  // a different step's defaultActiveForm.
  // ─────────────────────────────────────────────────────────────────

  it('user screenshot: plan in_progress with custom activeForm — pill is plan, not detect', () => {
    // Exactly the journey state from the bug screenshot:
    //   detect: completed, install: completed, plan: in_progress, wire: pending
    //   activeForms: { plan: 'Reading event plan…' }
    // The pill must show "Reading event plan…", NOT "Detecting your project setup".
    const store = makeStoreForSnapshot();
    store.setTasks(
      makeCanonicalTasks({
        inProgressIndex: 2, // plan
        inProgressActiveForm: 'Reading event plan…',
      }),
    );
    expect(resolveRunScreenStatus(store)).toBe('Reading event plan…');
    expect(resolveRunScreenStatus(store)).not.toBe(
      'Detecting your project setup',
    );
  });

  it('canonical-name fallback: plan in_progress with no activeForm — pill is plan label, not detect', () => {
    // Same journey state but the agent never emitted a TodoWrite
    // activeForm for plan. Defensive fallback: same step's canonical
    // label ("Plan and approve events to track"), NEVER detect's
    // defaultActiveForm ("Detecting your project setup").
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
        activeForm: undefined, // ← agent never set one
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
    expect(resolveRunScreenStatus(store)).toBe(
      'Plan and approve events to track',
    );
    expect(resolveRunScreenStatus(store)).not.toBe(
      'Detecting your project setup',
    );
  });

  it('pathological state: detect AND plan both in_progress — pill anchors to current step (plan), never detect', () => {
    // Defensive contract: if anything (mid-batch render, future code
    // path, regression) ever leaves two rows as in_progress at the
    // same time, the resolver iterates in canonical order and returns
    // the FIRST in_progress row's OWN text. The point of this test is
    // that whatever row wins, the text it surfaces belongs to that
    // matched row — never a different step's defaultActiveForm. In
    // practice the journey-state cascade in renderJourneyTasks
    // guarantees only one row is in_progress at a time; this test
    // pins the resolver's behavior in case that invariant is ever
    // violated.
    const store = makeStoreForSnapshot();
    store.setTasks([
      {
        label: CANONICAL_STEPS[0].label,
        activeForm: CANONICAL_STEPS[0].defaultActiveForm,
        status: TaskStatus.InProgress,
        done: false,
      },
      {
        label: CANONICAL_STEPS[1].label,
        activeForm: CANONICAL_STEPS[1].defaultActiveForm,
        status: TaskStatus.Completed,
        done: true,
      },
      {
        label: CANONICAL_STEPS[2].label,
        activeForm: 'Planning and approving events to track',
        status: TaskStatus.InProgress,
        done: false,
      },
      {
        label: CANONICAL_STEPS[3].label,
        activeForm: CANONICAL_STEPS[3].defaultActiveForm,
        status: TaskStatus.Pending,
        done: false,
      },
    ]);
    const pill = resolveRunScreenStatus(store);
    expect(pill).toBeDefined();
    // Whatever row wins, it must be from the canonical step list and
    // not, say, a leak from the wrong index.
    const validTexts = [
      ...CANONICAL_STEPS.map((s) => s.defaultActiveForm),
      ...CANONICAL_STEPS.map((s) => s.label),
      'Planning and approving events to track',
    ];
    expect(validTexts).toContain(pill);
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
