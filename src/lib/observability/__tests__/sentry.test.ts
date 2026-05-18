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

describe('initSentry — registerEsmLoaderHooks (DEP0205 root-cause fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Regression for the DEP0205 `module.register()` deprecation warning
  // emitted on Node.js >= 23 by `@sentry/node-core`'s ESM loader hook setup.
  // We fix it at the root: pass `registerEsmLoaderHooks: false` so Sentry
  // never calls the deprecated API. The wizard doesn't use ESM-loader-based
  // auto-instrumentation (HTTP/fetch tracing patch built-in modules
  // directly; MCP servers are wrapped via `wrapMcpServerWithSentry`).
  // If a future PR forgets this option, real users on Node 23+ will see
  // a deprecation warning on every `mcp serve` invocation.
  it('passes registerEsmLoaderHooks: false to Sentry.init', async () => {
    enableTelemetry();
    await initSentry({
      sessionId: 's',
      version: '0',
      mode: 'ci',
      debug: false,
    });
    expect(mockSentry.init).toHaveBeenCalledTimes(1);
    const initArgs = mockSentry.init.mock.calls[0]?.[0] as {
      registerEsmLoaderHooks?: boolean;
    };
    expect(initArgs.registerEsmLoaderHooks).toBe(false);
    restoreEnv();
  });

  // Belt-and-braces: simulate the synthetic DEP0205 warning that would
  // surface if `registerEsmLoaderHooks: false` were ever removed and the
  // import-in-the-middle stack triggered. The Node runtime's warning
  // channel still works normally for any unrelated DEP0205 call site —
  // we never patch `process.emitWarning`, so non-Sentry deprecations
  // remain visible to users and CI. We use a unique error subclass per
  // call to dodge Node's dedupe-by-(code,type) cache that would otherwise
  // collapse a second DEP0205 emission within the same process to a no-op.
  it('does not patch process.emitWarning — other DEP0205 warnings still surface', async () => {
    enableTelemetry();
    await initSentry({
      sessionId: 's',
      version: '0',
      mode: 'ci',
      debug: false,
    });

    const received: Array<{ code?: string; message: string }> = [];
    const listener = (w: Error & { code?: string }): void => {
      received.push({ code: w.code, message: w.message });
    };
    process.on('warning', listener);
    try {
      // Use the Error-object overload with a unique `code` value so Node
      // delivers it to listeners regardless of any prior DEP0205 emissions
      // earlier in the process lifetime (Node de-dupes by code+type for
      // the default stderr printer; with Error objects + unique codes it
      // still fans out to listeners on every call).
      const synthetic = new Error(
        'synthetic-other-source: module.register() is deprecated',
      ) as Error & { code: string };
      synthetic.name = 'DeprecationWarning';
      synthetic.code = `DEP0205-synthetic-${Date.now()}`;
      process.emitWarning(synthetic);
      // process.emitWarning is async — Node defers delivery to nextTick.
      // Yield once so listeners run before we assert.
      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      process.off('warning', listener);
    }

    expect(received).toHaveLength(1);
    expect(received[0]?.code).toMatch(/^DEP0205-synthetic-/);
    expect(received[0]?.message).toContain('synthetic-other-source');
    restoreEnv();
  });
});

describe('wrapMcpServerWithSentry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the input server unchanged when telemetry is disabled', async () => {
    disableTelemetry();
    await initSentry({
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

  it('delegates to Sentry.wrapMcpServerWithSentry when initialized', async () => {
    enableTelemetry();
    await initSentry({
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

  it('falls back to the raw server when Sentry throws', async () => {
    enableTelemetry();
    await initSentry({
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

  it('is a no-op when telemetry is disabled', async () => {
    disableTelemetry();
    await initSentry({
      sessionId: 's',
      version: '0',
      mode: 'ci',
      debug: false,
    });
    setSpanMeasurement('agent.tokens.input', 1234, 'token');
    expect(mockSentry.setMeasurement).not.toHaveBeenCalled();
    restoreEnv();
  });

  it('forwards name, value, unit to Sentry.setMeasurement', async () => {
    enableTelemetry();
    await initSentry({
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

  it('skips non-finite values (NaN / Infinity) without touching Sentry', async () => {
    enableTelemetry();
    await initSentry({
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

  it('swallows Sentry errors so the caller never sees them', async () => {
    enableTelemetry();
    await initSentry({
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
