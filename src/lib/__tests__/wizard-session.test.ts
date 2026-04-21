import { describe, it, expect } from 'vitest';
import { buildSession, RunPhase } from '../wizard-session.js';

// ── buildSession / parseProjectIdArg ──────────────────────────────────────────

describe('buildSession', () => {
  it('uses sensible defaults when called with no args', () => {
    const session = buildSession({});
    expect(session.debug).toBe(false);
    expect(session.ci).toBe(false);
    expect(session.region).toBeNull();
    expect(session.credentials).toBeNull();
    expect(session.runPhase).toBe(RunPhase.Idle);
    expect(session.introConcluded).toBe(false);
    expect(session.projectId).toBeUndefined();
  });

  it('passes through known args', () => {
    const session = buildSession({
      debug: true,
      ci: true,
      installDir: '/tmp/foo',
    });
    expect(session.debug).toBe(true);
    expect(session.ci).toBe(true);
    expect(session.installDir).toBe('/tmp/foo');
  });

  // ── parseProjectIdArg (exercised via buildSession projectId) ────────────────

  it('parses a valid positive integer string as projectId', () => {
    expect(buildSession({ projectId: '42' }).projectId).toBe(42);
  });

  it('parses "1" as projectId', () => {
    expect(buildSession({ projectId: '1' }).projectId).toBe(1);
  });

  it('returns undefined projectId for non-numeric string', () => {
    expect(buildSession({ projectId: 'abc' }).projectId).toBeUndefined();
  });

  it('returns undefined projectId for empty string', () => {
    expect(buildSession({ projectId: '' }).projectId).toBeUndefined();
  });

  it('returns undefined projectId for zero', () => {
    expect(buildSession({ projectId: '0' }).projectId).toBeUndefined();
  });

  it('returns undefined projectId for negative integer', () => {
    expect(buildSession({ projectId: '-5' }).projectId).toBeUndefined();
  });

  it('returns undefined projectId for non-integer float', () => {
    expect(buildSession({ projectId: '1.5' }).projectId).toBeUndefined();
  });

  it('returns undefined when projectId arg is omitted', () => {
    expect(buildSession({}).projectId).toBeUndefined();
  });
});
