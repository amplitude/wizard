/**
 * Pure assertion helpers for the eval harness (Bet 2 Slice 8).
 *
 * No I/O, no SDK mocks — these are the reducers that a fixture runner
 * calls after collecting the observed tool-call / event / file-write
 * streams. Kept separate so the assertion logic can be unit-tested
 * without booting the full harness.
 */

import type { EvalAssertion, EvalAssertionResult } from './types';

export interface ObservedRun {
  /** Tool names in call order. */
  toolCallSequence: string[];
  /** Full event names captured from analytics (with `wizard cli: ` prefix). */
  emittedEvents: string[];
  /** Strings that appeared in file writes/edits. */
  writtenStrings: string[];
  /** Terminal outcome of the run. */
  finalOutcome: 'success' | 'error' | 'cancelled';
}

function assertCalledToolBefore(
  assertion: Extract<EvalAssertion, { kind: 'called-tool-before' }>,
  run: ObservedRun,
): EvalAssertionResult {
  const firstTargetIdx = run.toolCallSequence.indexOf(assertion.toolName);
  if (firstTargetIdx === -1) {
    return {
      assertion,
      passed: false,
      detail: `${assertion.toolName} was never called`,
    };
  }
  for (const forbidden of assertion.beforeToolNames) {
    const earlierIdx = run.toolCallSequence.indexOf(forbidden);
    if (earlierIdx !== -1 && earlierIdx < firstTargetIdx) {
      return {
        assertion,
        passed: false,
        detail: `${forbidden} was called at position ${earlierIdx} before ${assertion.toolName} at position ${firstTargetIdx}`,
      };
    }
  }
  return { assertion, passed: true };
}

function assertEmittedEvent(
  assertion: Extract<EvalAssertion, { kind: 'emitted-event' }>,
  run: ObservedRun,
): EvalAssertionResult {
  const count = run.emittedEvents.filter(
    (name) => name === assertion.eventName,
  ).length;
  const min = assertion.minCount ?? 1;
  return {
    assertion,
    passed: count >= min,
    detail:
      count >= min
        ? undefined
        : `expected ≥${min} of ${assertion.eventName}, observed ${count}`,
  };
}

function assertNoSecretLeakage(
  assertion: Extract<EvalAssertion, { kind: 'no-secret-leakage' }>,
  run: ObservedRun,
): EvalAssertionResult {
  for (const forbidden of assertion.forbiddenStrings) {
    const match = run.writtenStrings.find((w) => w.includes(forbidden));
    if (match) {
      return {
        assertion,
        passed: false,
        // Redact the actual secret in the error detail — report only
        // which forbidden pattern leaked, not its value.
        detail: `forbidden literal "${forbidden.slice(
          0,
          8,
        )}…" appeared in a file write`,
      };
    }
  }
  return { assertion, passed: true };
}

function assertFinalOutcome(
  assertion: Extract<EvalAssertion, { kind: 'final-outcome' }>,
  run: ObservedRun,
): EvalAssertionResult {
  return {
    assertion,
    passed: run.finalOutcome === assertion.expected,
    detail:
      run.finalOutcome === assertion.expected
        ? undefined
        : `expected ${assertion.expected}, got ${run.finalOutcome}`,
  };
}

/** Evaluate every assertion against the observed run. */
export function evaluateAssertions(
  assertions: EvalAssertion[],
  run: ObservedRun,
): EvalAssertionResult[] {
  return assertions.map((a) => {
    switch (a.kind) {
      case 'called-tool-before':
        return assertCalledToolBefore(a, run);
      case 'emitted-event':
        return assertEmittedEvent(a, run);
      case 'no-secret-leakage':
        return assertNoSecretLeakage(a, run);
      case 'final-outcome':
        return assertFinalOutcome(a, run);
    }
  });
}
