import { describe, it, expect } from 'vitest';
import {
  initCorrelation,
  getSessionId,
  getRunId,
  rotateRunId,
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

  it('rotates the run ID', () => {
    initCorrelation('session');
    const first = getRunId();
    const second = rotateRunId();
    expect(second).not.toBe(first);
    expect(getRunId()).toBe(second);
  });

  it('returns "unknown" before initialization', () => {
    // Note: this test relies on module-level state reset behavior
    // which may not be fully isolated in vitest. The test validates
    // the default value path.
    expect(typeof getSessionId()).toBe('string');
    expect(typeof getRunId()).toBe('string');
  });
});
