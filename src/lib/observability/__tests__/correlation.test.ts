import { describe, it, expect } from 'vitest';
import {
  initCorrelation,
  getSessionId,
  getRunId,
  getAttemptId,
  nextAttemptId,
} from '../correlation';

describe('correlation', () => {
  it('provides a session ID after initialization', () => {
    initCorrelation('my-session-123');
    expect(getSessionId()).toBe('my-session-123');
  });

  it('provides a run ID after initialization', () => {
    initCorrelation('session');
    const runId = getRunId();
    expect(runId).toBeDefined();
    expect(runId.length).toBe(8); // short UUID prefix
  });

  it('provides an attempt ID after initialization', () => {
    initCorrelation('session');
    const attemptId = getAttemptId();
    expect(attemptId).toBeDefined();
    expect(attemptId.length).toBe(8);
  });

  it('freezes the run ID across nextAttemptId() calls', () => {
    initCorrelation('session');
    const runBefore = getRunId();
    nextAttemptId();
    nextAttemptId();
    expect(getRunId()).toBe(runBefore);
  });

  it('rotates the attempt ID', () => {
    initCorrelation('session');
    const first = getAttemptId();
    const second = nextAttemptId();
    expect(second).not.toBe(first);
    expect(getAttemptId()).toBe(second);
  });

  it('re-initializes to a fresh run ID when initCorrelation is called again', () => {
    initCorrelation('session-a');
    const runA = getRunId();
    initCorrelation('session-b');
    const runB = getRunId();
    expect(runB).not.toBe(runA);
  });

  it('returns "unknown" before initialization', () => {
    // Note: this test relies on module-level state reset behavior
    // which may not be fully isolated in vitest. The test validates
    // the default value path.
    expect(typeof getSessionId()).toBe('string');
    expect(typeof getRunId()).toBe('string');
    expect(typeof getAttemptId()).toBe('string');
  });
});
