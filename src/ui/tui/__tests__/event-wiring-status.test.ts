/**
 * Per-event wiring status — store mutators (`setEventPlan`,
 * `markEventStatus`, `noteWrittenContent`) and the `wire` →
 * completed cascade in `applyJourneyTransition`.
 *
 * Pins the contract for the per-event status list rendered in
 * RunScreen. The previous "comma-separated names" line collapsed to
 * one truncated row on every realistic terminal — users couldn't see
 * which events were in flight or done. This file is the unit-level
 * baseline; `RunScreen.eventStatus.test.tsx` covers the rendered
 * tree.
 */

import { describe, it, expect } from 'vitest';
import { WizardStore } from '../store.js';
import { Flow } from '../router.js';

function createStore(): WizardStore {
  return new WizardStore(Flow.Wizard);
}

describe('WizardStore — per-event wiring status', () => {
  describe('setEventPlan', () => {
    it('defaults every entry to status="pending" when caller omits it', () => {
      const store = createStore();
      store.setEventPlan([
        { name: 'User Signed Up', description: 'On signup form submit' },
        { name: 'User Signed In', description: 'On login form submit' },
      ]);
      expect(store.eventPlan).toEqual([
        {
          name: 'User Signed Up',
          description: 'On signup form submit',
          status: 'pending',
        },
        {
          name: 'User Signed In',
          description: 'On login form submit',
          status: 'pending',
        },
      ]);
    });

    it('preserves an explicit status when caller provides one', () => {
      const store = createStore();
      store.setEventPlan([
        {
          name: 'User Signed Up',
          description: 'On signup',
          status: 'done',
        },
      ]);
      expect(store.eventPlan[0].status).toBe('done');
    });
  });

  describe('markEventStatus', () => {
    it('flips a single matching event to the new status', () => {
      const store = createStore();
      store.setEventPlan([
        { name: 'User Signed Up', description: 'a' },
        { name: 'User Signed In', description: 'b' },
      ]);
      store.markEventStatus('User Signed Up', 'in_progress');
      expect(store.eventPlan[0].status).toBe('in_progress');
      expect(store.eventPlan[1].status).toBe('pending');
    });

    it('lookup is case-insensitive against the planned event name', () => {
      const store = createStore();
      store.setEventPlan([{ name: 'User Signed Up', description: '' }]);
      store.markEventStatus('user signed up', 'done');
      expect(store.eventPlan[0].status).toBe('done');
    });

    it('is a no-op for unknown event names (heuristic callers safe)', () => {
      const store = createStore();
      store.setEventPlan([{ name: 'User Signed Up', description: '' }]);
      const before = store.eventPlan;
      store.markEventStatus('Unrelated Event', 'done');
      expect(store.eventPlan).toBe(before); // same reference, no emit
    });

    it('never demotes a `done` event back to `in_progress` or `pending`', () => {
      const store = createStore();
      store.setEventPlan([{ name: 'User Signed Up', description: '' }]);
      store.markEventStatus('User Signed Up', 'done');
      store.markEventStatus('User Signed Up', 'in_progress');
      store.markEventStatus('User Signed Up', 'pending');
      expect(store.eventPlan[0].status).toBe('done');
    });

    it('allows `failed` to override a non-`done` status', () => {
      const store = createStore();
      store.setEventPlan([{ name: 'User Signed Up', description: '' }]);
      store.markEventStatus('User Signed Up', 'in_progress');
      store.markEventStatus('User Signed Up', 'failed');
      expect(store.eventPlan[0].status).toBe('failed');
    });

    it('does NOT let `failed` demote a `done` event', () => {
      // `done` is terminal — a stray `failed` emission (e.g. an
      // unrelated heuristic firing after the agent already wired the
      // track call) must not flip a successfully-applied event into a
      // failure. Matches the JSDoc invariant: "once an event is `done`
      // it never demotes" — `failed` only overrides non-`done`.
      const store = createStore();
      store.setEventPlan([{ name: 'User Signed Up', description: '' }]);
      store.markEventStatus('User Signed Up', 'done');
      store.markEventStatus('User Signed Up', 'failed');
      expect(store.eventPlan[0].status).toBe('done');
    });
  });

  describe('noteWrittenContent', () => {
    it('marks an event done when content contains track("Event Name", …)', () => {
      const store = createStore();
      store.setEventPlan([
        { name: 'User Signed Up', description: '' },
        { name: 'User Signed In', description: '' },
      ]);
      store.noteWrittenContent(
        `// signup handler
        amplitude.track('User Signed Up', { method: 'email' });`,
      );
      expect(store.eventPlan[0].status).toBe('done');
      expect(store.eventPlan[1].status).toBe('pending');
    });

    it('matches both single and double quotes', () => {
      const store = createStore();
      store.setEventPlan([
        { name: 'User Signed Up', description: '' },
        { name: 'User Signed In', description: '' },
      ]);
      store.noteWrittenContent(
        `track("User Signed Up");
         track('User Signed In');`,
      );
      expect(store.eventPlan[0].status).toBe('done');
      expect(store.eventPlan[1].status).toBe('done');
    });

    it('matches multi-event content in a single Write/Edit', () => {
      const store = createStore();
      store.setEventPlan([
        { name: 'User Signed Up', description: '' },
        { name: 'User Signed In', description: '' },
        { name: 'Order Completed', description: '' },
      ]);
      store.noteWrittenContent(`
        track('User Signed Up', { method: 'email' });
        track('User Signed In', {});
      `);
      const statuses = store.eventPlan.map((e) => e.status);
      expect(statuses).toEqual(['done', 'done', 'pending']);
    });

    it('is case-insensitive against planned event names', () => {
      const store = createStore();
      store.setEventPlan([{ name: 'User Signed Up', description: '' }]);
      store.noteWrittenContent(`track('user signed up')`);
      expect(store.eventPlan[0].status).toBe('done');
    });

    it('does not match a name that is not in the plan', () => {
      const store = createStore();
      store.setEventPlan([{ name: 'User Signed Up', description: '' }]);
      store.noteWrittenContent(`track('Some Other Event')`);
      expect(store.eventPlan[0].status).toBe('pending');
    });

    it('does not match a substring (track must be a word boundary)', () => {
      // `untracked` should not match — only the `track(…)` call form.
      const store = createStore();
      store.setEventPlan([{ name: 'User Signed Up', description: '' }]);
      store.noteWrittenContent(`untracked('User Signed Up')`);
      expect(store.eventPlan[0].status).toBe('pending');
    });

    it('matches `amplitude.track(…)` and `analytics.track(…)` shapes', () => {
      const store = createStore();
      store.setEventPlan([{ name: 'User Signed Up', description: '' }]);
      store.noteWrittenContent(`amplitude.track('User Signed Up', {});`);
      expect(store.eventPlan[0].status).toBe('done');
      // Reset for second shape.
      store.setEventPlan([{ name: 'User Signed Up', description: '' }]);
      store.noteWrittenContent(`analytics.track('User Signed Up');`);
      expect(store.eventPlan[0].status).toBe('done');
    });

    it('is a no-op when the event plan is empty', () => {
      const store = createStore();
      // No planned events — should not throw or panic on a track() call.
      store.noteWrittenContent(`track('Anything')`);
      expect(store.eventPlan).toEqual([]);
    });

    it('is a no-op when content has no track() call', () => {
      const store = createStore();
      store.setEventPlan([{ name: 'User Signed Up', description: '' }]);
      store.noteWrittenContent(`function helper() { return 42; }`);
      expect(store.eventPlan[0].status).toBe('pending');
    });
  });

  describe('applyJourneyTransition cascade', () => {
    it('marks remaining pending events as done when the wire step completes', () => {
      const store = createStore();
      store.setEventPlan([
        { name: 'User Signed Up', description: '' },
        { name: 'User Signed In', description: '' },
        { name: 'Order Completed', description: '' },
      ]);
      // Agent finished writing the first event but the others were
      // missed by the content scanner (e.g. agent used a tool the
      // hook didn't see).
      store.markEventStatus('User Signed Up', 'done');

      store.applyJourneyTransition('wire', 'completed');

      expect(store.eventPlan.map((e) => e.status)).toEqual([
        'done',
        'done',
        'done',
      ]);
    });

    it('preserves `failed` when the wire step completes', () => {
      const store = createStore();
      store.setEventPlan([
        { name: 'User Signed Up', description: '' },
        { name: 'User Signed In', description: '' },
      ]);
      store.markEventStatus('User Signed Up', 'failed');
      store.applyJourneyTransition('wire', 'completed');
      expect(store.eventPlan[0].status).toBe('failed');
      expect(store.eventPlan[1].status).toBe('done');
    });

    it('does not cascade on non-wire step completions', () => {
      const store = createStore();
      store.setEventPlan([{ name: 'User Signed Up', description: '' }]);
      store.applyJourneyTransition('install', 'completed');
      expect(store.eventPlan[0].status).toBe('pending');
    });

    it('does not cascade when wire moves to in_progress (only on completed)', () => {
      const store = createStore();
      store.setEventPlan([{ name: 'User Signed Up', description: '' }]);
      store.applyJourneyTransition('wire', 'in_progress');
      expect(store.eventPlan[0].status).toBe('pending');
    });

    // Regression: when the agent's TodoWrite (`syncTodos`) flips wire
    // to `completed` first, the later
    // `applyJourneyTransition('wire', 'completed')` from agent-runner
    // hits the monotonic guard and returns early. The cascade must
    // still run via the syncTodos path so pending events don't get
    // stranded in the UI.
    it('cascades when syncTodos drives wire→completed first', () => {
      const store = createStore();
      store.setEventPlan([
        { name: 'User Signed Up', description: '' },
        { name: 'User Signed In', description: '' },
      ]);
      store.syncTodos([
        {
          content: 'Wire up event tracking',
          status: 'completed',
          activeForm: 'Wiring up event tracking',
        },
      ]);
      expect(store.eventPlan.map((e) => e.status)).toEqual(['done', 'done']);

      // The redundant follow-up call from agent-runner is a no-op —
      // both pathways are idempotent.
      store.applyJourneyTransition('wire', 'completed');
      expect(store.eventPlan.map((e) => e.status)).toEqual(['done', 'done']);
    });

    it('preserves `failed` even when syncTodos drives the cascade', () => {
      const store = createStore();
      store.setEventPlan([
        { name: 'User Signed Up', description: '' },
        { name: 'User Signed In', description: '' },
      ]);
      store.markEventStatus('User Signed Up', 'failed');
      store.syncTodos([
        {
          content: 'Wire up event tracking',
          status: 'completed',
          activeForm: 'Wiring up event tracking',
        },
      ]);
      expect(store.eventPlan[0].status).toBe('failed');
      expect(store.eventPlan[1].status).toBe('done');
    });
  });
});
