import { beforeEach, describe, expect, it } from 'vitest';
import {
  getLatestEventPlanDecision,
  hasUnresolvedFeedback,
  noteFeedbackReinjection,
  recordEventPlanDecision,
  resetEventPlanFeedbackState,
  shouldReinjectFeedbackPrompt,
} from '../event-plan-feedback-state';

describe('event-plan-feedback-state singleton', () => {
  beforeEach(() => {
    resetEventPlanFeedbackState();
  });

  it('starts empty before any confirm_event_plan call', () => {
    expect(getLatestEventPlanDecision()).toBeNull();
    expect(hasUnresolvedFeedback()).toBe(false);
    expect(shouldReinjectFeedbackPrompt()).toBe(false);
  });

  it('records a feedback decision and surfaces it via the predicate', () => {
    recordEventPlanDecision({
      decision: 'feedback',
      events: [{ name: 'User Signed Up', description: 'signup' }],
      feedback: 'add a prefix',
    });

    expect(hasUnresolvedFeedback()).toBe(true);
    expect(shouldReinjectFeedbackPrompt()).toBe(true);

    const latest = getLatestEventPlanDecision();
    expect(latest?.decision).toBe('feedback');
    expect(latest?.feedback).toBe('add a prefix');
    expect(latest?.events).toEqual([
      { name: 'User Signed Up', description: 'signup' },
    ]);
    expect(latest?.callIndex).toBe(1);
  });

  it('caps re-injection at 1 — second note flips shouldReinject to false', () => {
    recordEventPlanDecision({
      decision: 'feedback',
      events: [{ name: 'X', description: 'y' }],
      feedback: 'rename',
    });
    expect(shouldReinjectFeedbackPrompt()).toBe(true);

    noteFeedbackReinjection();
    expect(shouldReinjectFeedbackPrompt()).toBe(false);
  });

  it('resets the re-injection counter when a new tool call lands', () => {
    recordEventPlanDecision({
      decision: 'feedback',
      events: [{ name: 'X', description: 'y' }],
      feedback: 'rename',
    });
    noteFeedbackReinjection();
    expect(shouldReinjectFeedbackPrompt()).toBe(false);

    // Agent revised and re-called — counter resets, but the new call
    // is ALSO a feedback decision, so re-injection is allowed again.
    recordEventPlanDecision({
      decision: 'feedback',
      events: [{ name: 'X2', description: 'y2' }],
      feedback: 'rename again',
    });
    expect(shouldReinjectFeedbackPrompt()).toBe(true);
  });

  it('clears unresolved feedback when the agent gets the plan approved', () => {
    recordEventPlanDecision({
      decision: 'feedback',
      events: [{ name: 'X', description: 'y' }],
      feedback: 'add a prefix',
    });
    recordEventPlanDecision({
      decision: 'approved',
      events: [{ name: 'App X', description: 'y' }],
    });

    expect(hasUnresolvedFeedback()).toBe(false);
    expect(shouldReinjectFeedbackPrompt()).toBe(false);
    const latest = getLatestEventPlanDecision();
    expect(latest?.decision).toBe('approved');
    expect(latest?.feedback).toBe('');
    expect(latest?.callIndex).toBe(2);
  });

  it('skipped clears feedback the same way approved does', () => {
    recordEventPlanDecision({
      decision: 'feedback',
      events: [{ name: 'X', description: 'y' }],
      feedback: 'rename',
    });
    recordEventPlanDecision({
      decision: 'skipped',
      events: [{ name: 'X', description: 'y' }],
    });

    expect(hasUnresolvedFeedback()).toBe(false);
  });

  it('resetEventPlanFeedbackState clears everything', () => {
    recordEventPlanDecision({
      decision: 'feedback',
      events: [{ name: 'X', description: 'y' }],
      feedback: 'rename',
    });
    resetEventPlanFeedbackState();
    expect(getLatestEventPlanDecision()).toBeNull();
    expect(shouldReinjectFeedbackPrompt()).toBe(false);
  });
});
