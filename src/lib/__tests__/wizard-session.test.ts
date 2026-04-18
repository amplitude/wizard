import { describe, it, expect } from 'vitest';
import { buildSession, RunPhase } from '../wizard-session.js';

// ── buildSession / parseAppIdArg ──────────────────────────────────────────

describe('buildSession', () => {
  it('uses sensible defaults when called with no args', () => {
    const session = buildSession({});
    expect(session.debug).toBe(false);
    expect(session.ci).toBe(false);
    expect(session.region).toBeNull();
    expect(session.credentials).toBeNull();
    expect(session.runPhase).toBe(RunPhase.Idle);
    expect(session.introConcluded).toBe(false);
    expect(session.appId).toBeUndefined();
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

  // ── parseAppIdArg (exercised via buildSession appId) ────────────────

  it('parses a valid positive integer string as appId', () => {
    expect(buildSession({ appId: '42' }).appId).toBe(42);
  });

  it('parses "1" as appId', () => {
    expect(buildSession({ appId: '1' }).appId).toBe(1);
  });

  it('returns undefined appId for non-numeric string', () => {
    expect(buildSession({ appId: 'abc' }).appId).toBeUndefined();
  });

  it('returns undefined appId for empty string', () => {
    expect(buildSession({ appId: '' }).appId).toBeUndefined();
  });

  it('returns undefined appId for zero', () => {
    expect(buildSession({ appId: '0' }).appId).toBeUndefined();
  });

  it('returns undefined appId for negative integer', () => {
    expect(buildSession({ appId: '-5' }).appId).toBeUndefined();
  });

  it('returns undefined appId for non-integer float', () => {
    expect(buildSession({ appId: '1.5' }).appId).toBeUndefined();
  });

  it('returns undefined when appId arg is omitted', () => {
    expect(buildSession({}).appId).toBeUndefined();
  });
});
