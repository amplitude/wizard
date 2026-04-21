import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildSession, RunPhase } from '../wizard-session.js';
import {
  saveCheckpoint,
  loadCheckpoint,
  clearCheckpoint,
} from '../session-checkpoint.js';

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

  it('initializes the new dashboard fields to null', () => {
    const s = buildSession({});
    expect(s.dashboardId).toBeNull();
    expect(s.dashboardUrl).toBeNull();
    expect(s.dashboardWarnings).toBeNull();
    expect(s.dashboardIdempotencyKey).toBeNull();
    expect(s.autocaptureEnabled).toBeNull();
  });
});

// ── Checkpoint round-trip for dashboard fields ───────────────────────────

describe('session-checkpoint dashboard round-trip', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      clearCheckpoint(tempDir);
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('persists idempotency key + dashboard metadata and restores them', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'wizard-ckpt-'));
    const session = buildSession({ installDir: tempDir });
    session.dashboardId = 'd-abc';
    session.dashboardUrl = 'https://app/dash/d-abc';
    session.dashboardWarnings = [
      { code: 'ENGAGEMENT_EVENTS_CAPPED', message: 'capped to 4' },
    ];
    session.dashboardIdempotencyKey = '00000000-0000-4000-8000-000000000001';
    session.autocaptureEnabled = true;

    saveCheckpoint(session);
    const restored = loadCheckpoint(tempDir);

    expect(restored).not.toBeNull();
    expect(restored?.dashboardId).toBe('d-abc');
    expect(restored?.dashboardUrl).toBe('https://app/dash/d-abc');
    expect(restored?.dashboardIdempotencyKey).toBe(
      '00000000-0000-4000-8000-000000000001',
    );
    expect(restored?.autocaptureEnabled).toBe(true);
    expect(restored?.dashboardWarnings).toEqual([
      { code: 'ENGAGEMENT_EVENTS_CAPPED', message: 'capped to 4' },
    ]);
  });

  it('gracefully returns null defaults for older checkpoints missing new fields', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'wizard-ckpt-'));
    const session = buildSession({ installDir: tempDir });
    // Save without setting any dashboard fields — simulates an older run
    saveCheckpoint(session);
    const restored = loadCheckpoint(tempDir);

    expect(restored?.dashboardId).toBeNull();
    expect(restored?.dashboardUrl).toBeNull();
    expect(restored?.dashboardWarnings).toBeNull();
    expect(restored?.dashboardIdempotencyKey).toBeNull();
    expect(restored?.autocaptureEnabled).toBeNull();
  });
});
