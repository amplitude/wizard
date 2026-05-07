/**
 * event-plan-feedback-state — process-singleton tracker for the most recent
 * `confirm_event_plan` decision and its associated payload.
 *
 * Why this module exists
 * ----------------------
 * `confirm_event_plan` (in `wizard-tools.ts`) is the gate the agent uses to
 * surface its proposed event plan to the user. The user can approve, skip,
 * or send feedback. When they send feedback the tool description tells the
 * agent to revise and call the tool AGAIN — i.e. loop until approved or
 * skipped.
 *
 * In practice agents have been observed mis-handling the feedback branch:
 * instead of revising and re-calling the tool, the agent emits a
 * clarifying question to the user ("What prefix would you like?") and
 * then stops. The Stop hook (in `agent-interface.ts`) is unconditional —
 * it then injects a `[WIZARD-REMARK]` request, the agent emits the
 * remark, the wizard advances Verify → Done, and `events.json` is never
 * persisted. The user is left with no event plan and no way to continue
 * iterating short of re-running the wizard.
 *
 * The Stop hook needs to know when the most recent `confirm_event_plan`
 * decision was `feedback` so it can inject a different prompt — one that
 * tells the agent to revise the plan (without asking the user further
 * questions) and re-call `confirm_event_plan`. This module is the
 * narrow seam the tool uses to publish that state and the hook uses to
 * read it.
 *
 * It is intentionally tiny and dependency-free: a single module-level
 * record plus three exported functions (record / read / clear). No I/O,
 * no analytics, no logging — the callers handle that. The state is
 * scoped to the wizard process; concurrent runs would never share a
 * Node process anyway, and tests can call `resetEventPlanFeedbackState()`
 * in their setup to start clean.
 */

/**
 * The shape of a captured `confirm_event_plan` outcome. Mirrors the tool's
 * own decision union but adds the fields the Stop hook needs to make a
 * useful re-injection prompt (the events themselves, plus the feedback
 * text).
 */
export type EventPlanFeedbackRecord = {
  /** The decision the user made on the most recent confirm_event_plan call. */
  decision: 'approved' | 'skipped' | 'feedback';
  /** The events the agent proposed on this call. Always populated. */
  events: Array<{ name: string; description: string }>;
  /**
   * The user's free-form feedback. Only populated when `decision === 'feedback'`.
   * Empty string for the other two decisions.
   */
  feedback: string;
  /**
   * Monotonically incremented per `confirm_event_plan` call so the Stop hook
   * can detect "no subsequent call landed yet" without chasing references.
   */
  callIndex: number;
};

/**
 * Process-wide singleton. `null` until the agent calls `confirm_event_plan`
 * for the first time. The module is loaded by both the tool factory
 * (`wizard-tools.ts#createWizardToolsServer`) and the Stop hook
 * (`agent-interface.ts#createStopHook` via `recordEventPlanDecision`'s
 * companion reader), so we deliberately keep it module-scoped instead of
 * threading it through closure plumbing.
 */
let latest: EventPlanFeedbackRecord | null = null;

/**
 * Tracks how many times the Stop hook has injected the feedback re-prompt
 * for the CURRENT unresolved-feedback record. Reset whenever a new
 * `confirm_event_plan` call lands. Bounded so we never infinite-loop:
 * after the cap, the Stop hook gives up and falls through to the normal
 * WIZARD-REMARK / allow-stop sequence so the run can actually conclude.
 */
let reinjectionCount = 0;

/**
 * Record a `confirm_event_plan` outcome. Called from inside the tool
 * implementation immediately after the user resolves the prompt, BEFORE
 * the result is returned to the agent. The Stop hook reads this state on
 * its next firing.
 *
 * `events` is whatever the agent passed on this call (already normalized
 * by the tool). `feedback` is the user's free-form text when
 * `decision === 'feedback'`; ignored for `'approved'` / `'skipped'`.
 */
export function recordEventPlanDecision(args: {
  decision: 'approved' | 'skipped' | 'feedback';
  events: Array<{ name: string; description: string }>;
  feedback?: string;
}): void {
  const nextCallIndex = (latest?.callIndex ?? 0) + 1;
  latest = {
    decision: args.decision,
    events: args.events.map((e) => ({ ...e })),
    feedback: args.decision === 'feedback' ? args.feedback ?? '' : '',
    callIndex: nextCallIndex,
  };
  // A new tool call landed — reset the re-injection counter so the next
  // unresolved feedback (if any) gets its full one-shot escalation budget.
  reinjectionCount = 0;
}

/**
 * Return the most recent `confirm_event_plan` record, or `null` if the
 * agent never called the tool this process. Read-only — callers must not
 * mutate the returned object (it shares structure with the singleton).
 */
export function getLatestEventPlanDecision(): EventPlanFeedbackRecord | null {
  return latest;
}

/**
 * Convenience predicate: was the most recent decision `feedback` and has
 * no subsequent `confirm_event_plan` call landed yet? True iff the Stop
 * hook should inject the feedback re-prompt instead of the WIZARD-REMARK
 * request.
 */
export function hasUnresolvedFeedback(): boolean {
  return latest?.decision === 'feedback';
}

/**
 * The Stop hook calls this when it injects the feedback re-prompt. The
 * counter is consulted by `shouldReinjectFeedbackPrompt()` so we cap the
 * loop at one re-injection per session and never block a run forever.
 */
export function noteFeedbackReinjection(): void {
  reinjectionCount += 1;
}

/**
 * True iff the Stop hook should inject the feedback re-prompt. Combines
 * the unresolved-feedback predicate with the per-session cap so the
 * caller doesn't have to remember both.
 */
export function shouldReinjectFeedbackPrompt(): boolean {
  return hasUnresolvedFeedback() && reinjectionCount < 1;
}

/**
 * Test-only: clear the singleton. Production code never calls this — the
 * Node process is a hard scope boundary. Tests run sequentially in one
 * process, so each test that exercises this module should reset it in
 * `beforeEach`.
 */
export function resetEventPlanFeedbackState(): void {
  latest = null;
  reinjectionCount = 0;
}
