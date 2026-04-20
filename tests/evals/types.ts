/**
 * Types for the wizard eval harness (Bet 2 Slice 8).
 *
 * Fixtures live as JSON under `tests/evals/fixtures/`. Each fixture
 * drives the wizard via mocked SDK messages and asserts on the
 * downstream behavior (tool calls, emitted events, final outcome).
 *
 * The harness is deliberately small — it's here to gate prompt changes
 * against a known-good checklist, not to replace integration tests.
 */

/** A single pass/fail check on an eval run. */
export type EvalAssertion =
  | {
      kind: 'called-tool-before';
      /** Tool whose call must precede all `beforeToolNames` tool calls. */
      toolName: string;
      /** Tools that must not appear before `toolName` in the call stream. */
      beforeToolNames: string[];
    }
  | {
      kind: 'emitted-event';
      /** Full Amplitude event name (with `wizard cli: ` prefix). */
      eventName: string;
      /** Minimum number of times the event must appear. Default 1. */
      minCount?: number;
    }
  | {
      kind: 'no-secret-leakage';
      /** Literal strings that must not appear in any file write or edit. */
      forbiddenStrings: string[];
    }
  | {
      kind: 'final-outcome';
      expected: 'success' | 'error' | 'cancelled';
    };

export interface EvalFixture {
  /** Unique fixture id (used in filenames + output). */
  id: string;
  description: string;
  /** Integration this fixture targets (nextjs, django, etc). */
  integration: string;
  /** Mocked SDK messages the runner will feed through runAgent. */
  mockedSDKStream: Array<Record<string, unknown>>;
  /** Checks that must all pass for the fixture to be green. */
  assertions: EvalAssertion[];
}

export interface EvalAssertionResult {
  assertion: EvalAssertion;
  passed: boolean;
  detail?: string;
}

export interface EvalResult {
  fixtureId: string;
  passed: boolean;
  assertions: EvalAssertionResult[];
  /** Raw tool-call sequence observed during the run, for debugging. */
  toolCallSequence: string[];
  /** Full event-name list captured from analytics calls. */
  emittedEvents: string[];
}
