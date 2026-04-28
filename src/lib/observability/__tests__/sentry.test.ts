/**
 * Tests for the new Sentry helpers added in this PR:
 *   - wrapMcpServerWithSentry — MCP server auto-instrumentation
 *   - setSpanMeasurement — token-count measurements on the active span
 *
 * Sentry's runtime is mocked. We verify wiring (the helper calls the right
 * Sentry export with the right shape) and the not-initialized fast-path
 * (no telemetry → no calls, returns input unchanged). No real network.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @sentry/node BEFORE importing sentry.ts so the module under test
// picks up our spies. We use vi.hoisted so the mock instance is constructed
// in the same hoisted block as the vi.mock call (vitest hoists vi.mock
// calls to the top of the module — top-level `const` lookups would fire
// before the const is bound).
const mockSentry = vi.hoisted(() => ({
  init: vi.fn(),
  setTag: vi.fn(),
  setUser: vi.fn(),
  flush: vi.fn().mockResolvedValue(true),
  startInactiveSpan: vi.fn(),
  startSpan: vi.fn((_opts: unknown, cb: (span: unknown) => unknown) =>
    cb({
      setStatus: vi.fn(),
      setAttribute: vi.fn(),
      end: vi.fn(),
    }),
  ),
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  setMeasurement: vi.fn(),
  wrapMcpServerWithSentry: vi.fn((s: unknown) => ({ wrapped: true, inner: s })),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@sentry/node', () => mockSentry);

// Force the env override so initSentry believes telemetry is enabled.
// NODE_ENV=test normally disables Sentry; we need to bypass that for the
// "initialized" path to exercise the wrapper and measurement logic.
const originalNodeEnv = process.env.NODE_ENV;
const originalDoNotTrack = process.env.DO_NOT_TRACK;
const originalNoTelemetry = process.env.AMPLITUDE_WIZARD_NO_TELEMETRY;

import {
  initSentry,
  wrapMcpServerWithSentry,
  setSpanMeasurement,
} from '../sentry';

function enableTelemetry(): void {
  process.env.NODE_ENV = 'production';
  delete process.env.DO_NOT_TRACK;
  delete process.env.AMPLITUDE_WIZARD_NO_TELEMETRY;
}

function disableTelemetry(): void {
  process.env.AMPLITUDE_WIZARD_NO_TELEMETRY = '1';
}

function restoreEnv(): void {
  if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
  else delete process.env.NODE_ENV;
  if (originalDoNotTrack !== undefined)
    process.env.DO_NOT_TRACK = originalDoNotTrack;
  else delete process.env.DO_NOT_TRACK;
  if (originalNoTelemetry !== undefined)
    process.env.AMPLITUDE_WIZARD_NO_TELEMETRY = originalNoTelemetry;
  else delete process.env.AMPLITUDE_WIZARD_NO_TELEMETRY;
}

describe('wrapMcpServerWithSentry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the input server unchanged when telemetry is disabled', () => {
    disableTelemetry();
    initSentry({
      sessionId: 's',
      version: '0',
      mode: 'ci',
      debug: false,
    });
    const server = { name: 'test-server' };
    const out = wrapMcpServerWithSentry(server);
    expect(out).toBe(server);
    expect(mockSentry.wrapMcpServerWithSentry).not.toHaveBeenCalled();
    restoreEnv();
  });

  it('delegates to Sentry.wrapMcpServerWithSentry when initialized', () => {
    enableTelemetry();
    initSentry({
      sessionId: 's',
      version: '0',
      mode: 'ci',
      debug: false,
    });
    const server = { name: 'test-server' };
    const out = wrapMcpServerWithSentry(server);
    expect(mockSentry.wrapMcpServerWithSentry).toHaveBeenCalledWith(server);
    expect(out).toEqual({ wrapped: true, inner: server });
    restoreEnv();
  });

  it('falls back to the raw server when Sentry throws', () => {
    enableTelemetry();
    initSentry({
      sessionId: 's',
      version: '0',
      mode: 'ci',
      debug: false,
    });
    mockSentry.wrapMcpServerWithSentry.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const server = { name: 'test-server' };
    const out = wrapMcpServerWithSentry(server);
    expect(out).toBe(server);
    restoreEnv();
  });
});

describe('setSpanMeasurement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is a no-op when telemetry is disabled', () => {
    disableTelemetry();
    initSentry({
      sessionId: 's',
      version: '0',
      mode: 'ci',
      debug: false,
    });
    setSpanMeasurement('agent.tokens.input', 1234, 'token');
    expect(mockSentry.setMeasurement).not.toHaveBeenCalled();
    restoreEnv();
  });

  it('forwards name, value, unit to Sentry.setMeasurement', () => {
    enableTelemetry();
    initSentry({
      sessionId: 's',
      version: '0',
      mode: 'ci',
      debug: false,
    });
    setSpanMeasurement('agent.tokens.output', 42, 'token');
    expect(mockSentry.setMeasurement).toHaveBeenCalledWith(
      'agent.tokens.output',
      42,
      'token',
    );
    restoreEnv();
  });

  it('skips non-finite values (NaN / Infinity) without touching Sentry', () => {
    enableTelemetry();
    initSentry({
      sessionId: 's',
      version: '0',
      mode: 'ci',
      debug: false,
    });
    setSpanMeasurement('agent.tokens.input', NaN, 'token');
    setSpanMeasurement('agent.tokens.input', Infinity, 'token');
    expect(mockSentry.setMeasurement).not.toHaveBeenCalled();
    restoreEnv();
  });

  it('swallows Sentry errors so the caller never sees them', () => {
    enableTelemetry();
    initSentry({
      sessionId: 's',
      version: '0',
      mode: 'ci',
      debug: false,
    });
    mockSentry.setMeasurement.mockImplementationOnce(() => {
      throw new Error('telemetry pipe broken');
    });
    expect(() =>
      setSpanMeasurement('agent.tokens.input', 100, 'token'),
    ).not.toThrow();
    restoreEnv();
  });
});
