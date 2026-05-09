/**
 * run-status-pill — tier-by-tier tests for the bottom-pill resolver.
 *
 * The resolver replaces the old "always show the canonical activeForm"
 * behavior with a prioritized cascade. Each test below pins one tier in
 * isolation, then a few combination tests verify priority ordering.
 *
 * Design intent: future refactors of the resolver MUST keep these
 * priorities stable. If a tier needs to change priority, update both
 * the resolver and these tests in the same PR.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  resolveRunStatusPill,
  formatFileWriteForPill,
} from '../run-status-pill.js';
import { makeStoreForSnapshot } from '../../__tests__/snapshot-utils.js';
import { TaskStatus } from '../../../wizard-ui.js';
import { PostAgentStepStatus } from '../../session-constants.js';
import { CANONICAL_STEPS } from '../../../../lib/canonical-tasks.js';

const T0 = 1_700_000_000_000; // fixed "now" reference for all freshness checks

// Pin Date.now() so store mutators (recordFileChangePlanned,
// recordToolActivity, …) stamp entries with T0 instead of the real clock.
// Without this, the entries land "in 2026" while the resolver's `now`
// argument is in 2023, freshness math goes negative, and stale tests
// look fresh.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(T0));
});

afterEach(() => {
  vi.useRealTimers();
});

function makeCanonicalTasks(opts: {
  inProgressIndex: number;
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

describe('resolveRunStatusPill — tier 1: post-agent step', () => {
  it('returns the in-progress post-agent step activeForm above all others', () => {
    const store = makeStoreForSnapshot({
      postAgentSteps: [
        {
          id: 'create-dashboard',
          label: 'Create your starter dashboard',
          activeForm: 'Creating your starter dashboard',
          status: PostAgentStepStatus.InProgress,
        },
      ],
      // Even with a compaction activity (tier 2) and an in-progress canonical
      // task (tier 6), the post-agent step wins.
      currentActivity: {
        kind: 'compaction',
        message: 'Compacting context (typically ~60s)',
        startedAt: T0,
        estimatedDurationSec: 60,
      },
    });
    store.setTasks(makeCanonicalTasks({ inProgressIndex: 3 }));

    expect(resolveRunStatusPill(store, T0)).toBe(
      'Creating your starter dashboard',
    );
  });
});

describe('resolveRunStatusPill — tier 2: currentActivity (compaction / retry / cold-start)', () => {
  it('surfaces the compaction message instead of the canonical step', () => {
    const store = makeStoreForSnapshot({
      currentActivity: {
        kind: 'compaction',
        message: 'Compacting context (typically ~60s)',
        startedAt: T0,
        estimatedDurationSec: 60,
      },
    });
    store.setTasks(makeCanonicalTasks({ inProgressIndex: 3 }));

    expect(resolveRunStatusPill(store, T0)).toBe(
      'Compacting context (typically ~60s)',
    );
  });

  it('surfaces a rate-limit-retry message', () => {
    const store = makeStoreForSnapshot({
      currentActivity: {
        kind: 'rate-limit-retry',
        message:
          'Rate limited by Anthropic. Waiting 17s before retry (attempt 2/6).',
        startedAt: T0,
      },
    });
    store.setTasks(makeCanonicalTasks({ inProgressIndex: 3 }));

    expect(resolveRunStatusPill(store, T0)).toBe(
      'Rate limited by Anthropic. Waiting 17s before retry (attempt 2/6).',
    );
  });
});

describe('resolveRunStatusPill — tier 3: pending event-plan prompt', () => {
  it('shows "N events planned · awaiting your sign-off" while modal prompt is open', () => {
    const store = makeStoreForSnapshot();
    store.setTasks(makeCanonicalTasks({ inProgressIndex: 2 }));
    // Use the public API: requestEventPlanDecision pushes a prompt.
    store.promptEventPlan([
      { name: 'User Signed Up', description: 'a' },
      { name: 'Item Added', description: 'b' },
      { name: 'Checkout Started', description: 'c' },
    ]);

    expect(resolveRunStatusPill(store, T0)).toBe(
      '3 events planned · awaiting your sign-off',
    );
  });

  it('singularizes when there is exactly one event', () => {
    const store = makeStoreForSnapshot();
    store.promptEventPlan([{ name: 'Only Event', description: 'one' }]);
    expect(resolveRunStatusPill(store, T0)).toBe(
      '1 event planned · awaiting your sign-off',
    );
  });
});

describe('resolveRunStatusPill — tier 4: recent file write', () => {
  it('renders "Editing <path>" while a modify is planned (in-flight)', () => {
    const store = makeStoreForSnapshot({
      installDir: '/proj',
    });
    store.setTasks(makeCanonicalTasks({ inProgressIndex: 3 }));
    store.recordFileChangePlanned({
      path: '/proj/src/auth/signin.tsx',
      operation: 'modify',
    });

    expect(resolveRunStatusPill(store, T0)).toBe('Editing src/auth/signin.tsx');
  });

  it('renders "✓ Wrote <path>" when an applied event is fresh', () => {
    const store = makeStoreForSnapshot({ installDir: '/proj' });
    store.setTasks(makeCanonicalTasks({ inProgressIndex: 3 }));
    store.recordFileChangePlanned({
      path: '/proj/src/lib/foo.ts',
      operation: 'modify',
    });
    store.recordFileChangeApplied({
      path: '/proj/src/lib/foo.ts',
      operation: 'modify',
    });

    expect(resolveRunStatusPill(store, T0)).toBe('✓ Wrote src/lib/foo.ts');
  });

  it('falls through to suppressed tier 6 when the file event is stale', () => {
    const store = makeStoreForSnapshot({ installDir: '/proj' });
    store.setTasks(
      makeCanonicalTasks({
        inProgressIndex: 3,
        inProgressActiveForm: 'Wiring up event tracking',
      }),
    );
    store.recordFileChangePlanned({
      path: '/proj/src/lib/foo.ts',
      operation: 'modify',
    });
    // 10s later — past the 3s freshness window. Tier 6 is suppressed
    // (#688 made the pill flush with the Tasks list, so repeating the
    // canonical task's activeForm is now a visible duplicate), so the
    // resolver returns undefined and no pill is rendered.
    expect(resolveRunStatusPill(store, T0 + 10_000)).toBeUndefined();
  });
});

describe('resolveRunStatusPill — tier 5: recent tool activity', () => {
  it('passes through the verb-formatted toolActivity label when fresh', () => {
    const store = makeStoreForSnapshot();
    store.setTasks(makeCanonicalTasks({ inProgressIndex: 0 }));
    store.recordToolActivity('Reading package.json');

    expect(resolveRunStatusPill(store, T0)).toBe('Reading package.json');
  });

  it('falls through when stale (tier 6 suppressed → undefined)', () => {
    const store = makeStoreForSnapshot();
    store.setTasks(
      makeCanonicalTasks({
        inProgressIndex: 0,
        inProgressActiveForm: 'Detecting your project setup',
      }),
    );
    store.recordToolActivity('Reading package.json');

    // 10s later. Falls through past stale tier 5 to tier 6 — which is
    // now suppressed because the Tasks list already shows
    // 'Detecting your project setup' as its in-progress row. Resolver
    // returns undefined, no pill rendered.
    expect(resolveRunStatusPill(store, T0 + 10_000)).toBeUndefined();
  });

  it('prefers a fresh file write over a fresh tool activity (tier 4 > tier 5)', () => {
    const store = makeStoreForSnapshot({ installDir: '/proj' });
    store.recordToolActivity('Reading package.json');
    store.recordFileChangePlanned({
      path: '/proj/src/index.ts',
      operation: 'modify',
    });
    expect(resolveRunStatusPill(store, T0)).toBe('Editing src/index.ts');
  });
});

describe('resolveRunStatusPill — tier 6: canonical task suppressed to avoid duplicating Tasks list', () => {
  // After PR #688 the inline status pill became flush with the content
  // area, sitting directly under the Tasks list. Tier 6 used to return
  // the in-progress canonical task's `activeForm`, which is the SAME
  // string ProgressList already renders for that row above the pill —
  // producing visible duplicates like:
  //   › Detecting project setup        (Tasks list)
  //   ◇ Detecting project setup        (pill, immediately below)
  // The resolver now suppresses tier 6 entirely — when no higher-priority
  // tier (file write, tool activity, event-plan await, currentActivity,
  // postAgentStep) is active, the pill is omitted so the Tasks list is
  // not echoed.

  it('returns undefined when the only signal is an in-progress canonical task (no duplicate of Tasks list)', () => {
    const store = makeStoreForSnapshot();
    store.setTasks(
      makeCanonicalTasks({
        inProgressIndex: 3,
        inProgressActiveForm: 'Wiring up event tracking',
      }),
    );

    expect(resolveRunStatusPill(store, T0)).toBeUndefined();
  });

  it("does NOT fall back to the canonical step's defaultActiveForm when the agent never set one", () => {
    // Previously this returned 'Plan and approve events to track' (the
    // canonical label) so the pill always had something. With suppression
    // it returns undefined — same reason: the Tasks list already shows
    // that label as its in-progress row.
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
    expect(resolveRunStatusPill(store, T0)).toBeUndefined();
  });

  // Test #1 from the bug spec: when the active task's activeForm matches
  // what tier 6 would return, the resolver returns undefined.
  it('returns undefined when the active task activeForm matches tier-6 fallback (suppression intent)', () => {
    const store = makeStoreForSnapshot();
    store.setTasks(
      makeCanonicalTasks({
        inProgressIndex: 0,
        inProgressActiveForm: 'Detecting project setup',
      }),
    );

    expect(resolveRunStatusPill(store, T0)).toBeUndefined();
  });

  // Test #2: a higher-priority tier whose text coincidentally matches
  // the active task's activeForm still wins — don't over-suppress.
  it('does not over-suppress: tier 5 (tool activity) still wins even if its label happens to equal the canonical activeForm', () => {
    const store = makeStoreForSnapshot();
    store.setTasks(
      makeCanonicalTasks({
        inProgressIndex: 0,
        inProgressActiveForm: 'Detecting project setup',
      }),
    );
    // Tool activity label coincidentally matches the canonical activeForm.
    // This shouldn't happen in practice (tool labels are verb-formatted
    // file/command strings), but the suppression rule must scope to tier 6
    // only — higher tiers are NEVER suppressed because their semantics
    // ("an event JUST happened") differ from a long-running task label.
    store.recordToolActivity('Detecting project setup');

    expect(resolveRunStatusPill(store, T0)).toBe('Detecting project setup');
  });

  it('does not over-suppress: tier 4 (file write) still wins for the same active task', () => {
    const store = makeStoreForSnapshot({ installDir: '/proj' });
    store.setTasks(
      makeCanonicalTasks({
        inProgressIndex: 0,
        inProgressActiveForm: 'Detecting project setup',
      }),
    );
    store.recordFileChangePlanned({
      path: '/proj/src/lib/foo.ts',
      operation: 'modify',
    });

    expect(resolveRunStatusPill(store, T0)).toBe('Editing src/lib/foo.ts');
  });

  it('does not over-suppress: tier 2 (currentActivity) still wins for the same active task', () => {
    const store = makeStoreForSnapshot({
      currentActivity: {
        kind: 'compaction',
        message: 'Compacting context (typically ~60s)',
        startedAt: T0,
      },
    });
    store.setTasks(
      makeCanonicalTasks({
        inProgressIndex: 0,
        inProgressActiveForm: 'Detecting project setup',
      }),
    );

    expect(resolveRunStatusPill(store, T0)).toBe(
      'Compacting context (typically ~60s)',
    );
  });

  // Test #3: when no tier returns anything, resolver returns undefined.
  it('returns undefined when no tier has any signal (existing tier-7 cold-start gap behavior preserved when no canonical task is in progress)', () => {
    const store = makeStoreForSnapshot();
    expect(store.tasks.length).toBe(0);
    expect(resolveRunStatusPill(store, T0)).toBeUndefined();
  });

  // Test #4 — pinning test for the reported screenshot scenario.
  // Task `Detect` in_progress with activeForm: 'Detecting project setup',
  // no file-writes / tool-activity within 3s, no compaction, no
  // event-plan-await → resolver returns undefined.
  it('pinning: Detect in_progress with stale signals returns undefined (the #688 duplicate-pill regression)', () => {
    const store = makeStoreForSnapshot({ installDir: '/proj' });
    store.setTasks(
      makeCanonicalTasks({
        inProgressIndex: 0,
        inProgressActiveForm: 'Detecting project setup',
      }),
    );
    // Stale tool activity + file write — both >3s old at the resolver call.
    store.recordToolActivity('Reading package.json');
    store.recordFileChangePlanned({
      path: '/proj/package.json',
      operation: 'modify',
    });

    // 10s later — both are stale. No compaction, no event-plan prompt,
    // no post-agent step. Should return undefined (no pill).
    expect(resolveRunStatusPill(store, T0 + 10_000)).toBeUndefined();
  });

  // The #646 regression — pushStatus narration should NOT leak through
  // tier 7 once a canonical task is in_progress. Tier 6 is suppressed,
  // but the resolver must still skip tier 7 in that state to avoid
  // "Now let me plan the events…" leaking into the pill mid-run.
  it('skips tier 7 (pushStatus) when a canonical task is in_progress (no stale narration leak)', () => {
    const store = makeStoreForSnapshot();
    store.setTasks(
      makeCanonicalTasks({
        inProgressIndex: 3,
        inProgressActiveForm: 'Wiring up event tracking',
      }),
    );
    store.pushStatus("Now let me plan the events based on what I've read");

    expect(resolveRunStatusPill(store, T0)).toBeUndefined();
  });
});

describe('resolveRunStatusPill — tier 7: trailing pushStatus (cold-start)', () => {
  it('returns the trailing statusMessage when nothing else exists', () => {
    const store = makeStoreForSnapshot();
    expect(store.tasks.length).toBe(0);
    store.pushStatus('Reading package.json');

    expect(resolveRunStatusPill(store, T0)).toBe('Reading package.json');
  });

  it('returns undefined when no signal exists at all', () => {
    const store = makeStoreForSnapshot();
    expect(resolveRunStatusPill(store, T0)).toBeUndefined();
  });
});

describe('resolveRunStatusPill — priority interactions', () => {
  it('post-agent step (1) > activity (2) > event-plan prompt (3) > file write (4) > tool activity (5) > canonical (6) > pushStatus (7)', () => {
    // Build a store with EVERY tier populated, then verify the highest
    // tier wins. We then sequentially clear tiers and re-check.
    const store = makeStoreForSnapshot({
      installDir: '/proj',
      currentActivity: {
        kind: 'compaction',
        message: 'Compacting context',
        startedAt: T0,
      },
      postAgentSteps: [
        {
          id: 'create-dashboard',
          label: 'Create dashboard',
          activeForm: 'Creating dashboard',
          status: PostAgentStepStatus.InProgress,
        },
      ],
    });
    store.setTasks(makeCanonicalTasks({ inProgressIndex: 3 }));
    store.promptEventPlan([{ name: 'A', description: 'a' }]);
    store.recordToolActivity('Reading package.json');
    store.recordFileChangePlanned({
      path: '/proj/src/lib/foo.ts',
      operation: 'modify',
    });
    store.pushStatus('stale narration');

    // Tier 1 wins.
    expect(resolveRunStatusPill(store, T0)).toBe('Creating dashboard');

    // Clear tier 1 → tier 2 wins.
    store.session = { ...store.session, postAgentSteps: [] };
    expect(resolveRunStatusPill(store, T0)).toBe('Compacting context');

    // Clear tier 2 → tier 3 wins.
    store.session = { ...store.session, currentActivity: null };
    expect(resolveRunStatusPill(store, T0)).toBe(
      '1 event planned · awaiting your sign-off',
    );

    // Clear tier 3 → tier 4 wins.
    store.resolveEventPlan({ decision: 'approved' });
    expect(resolveRunStatusPill(store, T0)).toBe('Editing src/lib/foo.ts');

    // Make tier 4 stale → tier 5 wins (within its window).
    // Re-record tool activity at T0+5000 so it's fresh when file write is stale.
    vi.setSystemTime(new Date(T0 + 5000));
    store.recordToolActivity('Reading package.json');
    expect(resolveRunStatusPill(store, T0 + 5000)).toBe('Reading package.json');

    // Make tier 5 stale → tier 6 is suppressed. Resolver returns
    // undefined because the Tasks list already shows the in-progress
    // canonical task's activeForm above the pill (PR #688 made the pill
    // flush with content; repeating that text was a visible duplicate).
    expect(resolveRunStatusPill(store, T0 + 10_000)).toBeUndefined();
  });
});

describe('formatFileWriteForPill', () => {
  it('formats planned modify as "Editing"', () => {
    expect(
      formatFileWriteForPill({
        path: '/proj/src/foo.ts',
        operation: 'modify',
        status: 'planned',
      }),
    ).toBe('Editing /proj/src/foo.ts');
  });

  it('formats applied modify as "✓ Wrote"', () => {
    expect(
      formatFileWriteForPill({
        path: '/proj/src/foo.ts',
        operation: 'modify',
        status: 'applied',
      }),
    ).toBe('✓ Wrote /proj/src/foo.ts');
  });

  it('formats planned create as "Creating"', () => {
    expect(
      formatFileWriteForPill({
        path: '/proj/src/new.ts',
        operation: 'create',
        status: 'planned',
      }),
    ).toBe('Creating /proj/src/new.ts');
  });

  it('formats applied create as "✓ Created"', () => {
    expect(
      formatFileWriteForPill({
        path: '/proj/src/new.ts',
        operation: 'create',
        status: 'applied',
      }),
    ).toBe('✓ Created /proj/src/new.ts');
  });

  it('formats failed as "✗ Failed"', () => {
    expect(
      formatFileWriteForPill({
        path: '/proj/src/x.ts',
        operation: 'modify',
        status: 'failed',
      }),
    ).toBe('✗ Failed /proj/src/x.ts');
  });

  it('relativizes paths against installDir', () => {
    expect(
      formatFileWriteForPill(
        {
          path: '/proj/src/foo.ts',
          operation: 'modify',
          status: 'planned',
        },
        '/proj',
      ),
    ).toBe('Editing src/foo.ts');
  });
});
