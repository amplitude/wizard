/**
 * Bet 2 Slice 8 — eval harness assertion helpers.
 *
 * Covers the pure reducer logic so bad assertions fail loudly when a
 * fixture hits an unexpected tool-call order, a missing event, a
 * secret leakage, or a wrong final outcome.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateAssertions,
  type ObservedRun,
} from '../../../tests/evals/assert';
import type { EvalAssertion } from '../../../tests/evals/types';

const baseRun: ObservedRun = {
  toolCallSequence: [],
  emittedEvents: [],
  writtenStrings: [],
  finalOutcome: 'success',
};

describe('called-tool-before', () => {
  it('passes when the gate tool precedes all forbidden followers', () => {
    const run: ObservedRun = {
      ...baseRun,
      toolCallSequence: ['Read', 'confirm_event_plan', 'Write', 'Edit'],
    };
    const assertion: EvalAssertion = {
      kind: 'called-tool-before',
      toolName: 'confirm_event_plan',
      beforeToolNames: ['Write', 'Edit'],
    };
    const [result] = evaluateAssertions([assertion], run);
    expect(result.passed).toBe(true);
  });

  it('fails when a forbidden follower appears before the gate tool', () => {
    const run: ObservedRun = {
      ...baseRun,
      toolCallSequence: ['Write', 'confirm_event_plan', 'Edit'],
    };
    const assertion: EvalAssertion = {
      kind: 'called-tool-before',
      toolName: 'confirm_event_plan',
      beforeToolNames: ['Write'],
    };
    const [result] = evaluateAssertions([assertion], run);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('Write was called');
  });

  it('fails when the gate tool was never called', () => {
    const run: ObservedRun = {
      ...baseRun,
      toolCallSequence: ['Read', 'Write'],
    };
    const assertion: EvalAssertion = {
      kind: 'called-tool-before',
      toolName: 'confirm_event_plan',
      beforeToolNames: ['Write'],
    };
    const [result] = evaluateAssertions([assertion], run);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('never called');
  });
});

describe('emitted-event', () => {
  it('passes when the event was emitted at least once', () => {
    const run: ObservedRun = {
      ...baseRun,
      emittedEvents: ['wizard cli: agent completed'],
    };
    const [result] = evaluateAssertions(
      [
        {
          kind: 'emitted-event',
          eventName: 'wizard cli: agent completed',
        },
      ],
      run,
    );
    expect(result.passed).toBe(true);
  });

  it('fails when the event count is below minCount', () => {
    const run: ObservedRun = {
      ...baseRun,
      emittedEvents: ['wizard cli: step completed'],
    };
    const [result] = evaluateAssertions(
      [
        {
          kind: 'emitted-event',
          eventName: 'wizard cli: step completed',
          minCount: 3,
        },
      ],
      run,
    );
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('observed 1');
  });
});

describe('no-secret-leakage', () => {
  it('passes when no forbidden string appeared in writes', () => {
    const run: ObservedRun = {
      ...baseRun,
      writtenStrings: ['import { init } from "@amplitude/analytics-browser";'],
    };
    const [result] = evaluateAssertions(
      [
        {
          kind: 'no-secret-leakage',
          forbiddenStrings: ['secret-key-abc123'],
        },
      ],
      run,
    );
    expect(result.passed).toBe(true);
  });

  it('fails when a forbidden string appears in a write, redacting detail', () => {
    const run: ObservedRun = {
      ...baseRun,
      writtenStrings: ['const apiKey = "secret-key-abc123";'],
    };
    const [result] = evaluateAssertions(
      [
        {
          kind: 'no-secret-leakage',
          forbiddenStrings: ['secret-key-abc123'],
        },
      ],
      run,
    );
    expect(result.passed).toBe(false);
    // Detail should redact the actual secret — only first 8 chars shown
    expect(result.detail).toContain('secret-k');
    expect(result.detail).not.toContain('abc123');
  });
});

describe('final-outcome', () => {
  it('passes when the outcome matches', () => {
    const [result] = evaluateAssertions(
      [{ kind: 'final-outcome', expected: 'success' }],
      baseRun,
    );
    expect(result.passed).toBe(true);
  });

  it('fails when the outcome does not match', () => {
    const [result] = evaluateAssertions(
      [{ kind: 'final-outcome', expected: 'error' }],
      baseRun,
    );
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('expected error, got success');
  });
});

describe('evaluateAssertions aggregate', () => {
  it('returns one result per assertion, preserving order', () => {
    const results = evaluateAssertions(
      [
        { kind: 'final-outcome', expected: 'success' },
        {
          kind: 'emitted-event',
          eventName: 'wizard cli: agent completed',
        },
      ],
      baseRun,
    );
    expect(results).toHaveLength(2);
    expect(results[0].assertion.kind).toBe('final-outcome');
    expect(results[1].assertion.kind).toBe('emitted-event');
  });
});
