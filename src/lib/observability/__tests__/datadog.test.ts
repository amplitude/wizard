import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockInstance,
} from 'vitest';
import { initCorrelation } from '../correlation';

// Dynamically re-import the module for each test to reset module-level state.
// The module keeps `initialized` and `buffer` as module-level singletons.
let mod: typeof import('../datadog');

async function loadModule() {
  // Reset module cache so we get fresh state
  vi.resetModules();
  mod = await import('../datadog');
}

describe('datadog', () => {
  let fetchSpy: MockInstance;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    // Clean env
    delete process.env.DD_API_KEY;
    delete process.env.DATADOG_API_KEY;
    delete process.env.DD_SITE;
    delete process.env.DD_SERVICE;
    delete process.env.DD_ENV;
    delete process.env.DD_TAGS;
    delete process.env.DO_NOT_TRACK;
    delete process.env.AMPLITUDE_WIZARD_NO_TELEMETRY;

    // Override NODE_ENV from 'test' to allow initialization
    process.env.NODE_ENV = 'development';

    initCorrelation('test-dd-session');

    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 202 }));

    await loadModule();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  describe('initDatadog', () => {
    it('no-ops when DD_API_KEY is not set', () => {
      mod.initDatadog({
        sessionId: 'test',
        version: '1.0.0',
        mode: 'interactive',
      });
      expect(mod.isDatadogInitialized()).toBe(false);
    });

    it('initializes when DD_API_KEY is set', () => {
      process.env.DD_API_KEY = 'test-api-key-abc123xyz';
      mod.initDatadog({
        sessionId: 'test',
        version: '1.0.0',
        mode: 'interactive',
      });
      expect(mod.isDatadogInitialized()).toBe(true);
    });

    it('respects DATADOG_API_KEY as alternative', () => {
      process.env.DATADOG_API_KEY = 'alt-api-key-123';
      mod.initDatadog({
        sessionId: 'test',
        version: '1.0.0',
        mode: 'ci',
      });
      expect(mod.isDatadogInitialized()).toBe(true);
    });

    it('no-ops when DO_NOT_TRACK=1', () => {
      process.env.DD_API_KEY = 'test-key';
      process.env.DO_NOT_TRACK = '1';
      mod.initDatadog({
        sessionId: 'test',
        version: '1.0.0',
        mode: 'interactive',
      });
      expect(mod.isDatadogInitialized()).toBe(false);
    });

    it('no-ops when AMPLITUDE_WIZARD_NO_TELEMETRY=1', () => {
      process.env.DD_API_KEY = 'test-key';
      process.env.AMPLITUDE_WIZARD_NO_TELEMETRY = '1';
      mod.initDatadog({
        sessionId: 'test',
        version: '1.0.0',
        mode: 'interactive',
      });
      expect(mod.isDatadogInitialized()).toBe(false);
    });
  });

  describe('datadogLog', () => {
    beforeEach(async () => {
      // Re-init correlation after module reset so IDs are available
      const { initCorrelation: reinit } = await import('../correlation');
      reinit('test-dd-session');
      process.env.DD_API_KEY = 'test-api-key-abc123xyz';
      mod.initDatadog({
        sessionId: 'test-session',
        version: '2.0.0',
        mode: 'interactive',
      });
    });

    it('buffers log entries without immediately flushing', () => {
      mod.datadogLog('info', 'test-ns', 'hello datadog');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('flushes buffered entries on flushDatadog()', async () => {
      mod.datadogLog('info', 'test-ns', 'hello datadog', { key: 'value' });
      await mod.flushDatadog();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(url).toBe('https://http-intake.logs.datadoghq.com/api/v2/logs');
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual(
        expect.objectContaining({
          'Content-Type': 'application/json',
          'DD-API-KEY': 'test-api-key-abc123xyz',
        }),
      );

      const body = JSON.parse(options.body as string) as Array<
        Record<string, unknown>
      >;
      // First entry is the init event, second is ours
      const entry = body.find((e) => e.message === 'hello datadog');
      expect(entry).toBeDefined();
      expect(entry).toMatchObject({
        message: 'hello datadog',
        service: 'amplitude-wizard',
        status: 'info',
        ddsource: 'nodejs',
        wizard_version: '2.0.0',
        execution_mode: 'interactive',
      });
      expect(entry!.context).toEqual({ key: 'value' });
      expect(entry!.session_id).toBe('test-dd-session');
    });

    it('uses custom DD_SITE', async () => {
      // Re-init with custom site
      await loadModule();
      process.env.DD_API_KEY = 'key123';
      process.env.DD_SITE = 'datadoghq.eu';
      process.env.NODE_ENV = 'development';
      mod.initDatadog({
        sessionId: 'test',
        version: '1.0.0',
        mode: 'interactive',
      });

      mod.datadogLog('warn', 'ns', 'eu test');
      await mod.flushDatadog();

      const [euUrl] = fetchSpy.mock.calls[0] as [string];
      expect(euUrl).toBe('https://http-intake.logs.datadoghq.eu/api/v2/logs');
    });
  });

  describe('datadogEvent', () => {
    beforeEach(() => {
      process.env.DD_API_KEY = 'test-api-key-abc123xyz';
      mod.initDatadog({
        sessionId: 'test-session',
        version: '2.0.0',
        mode: 'ci',
      });
    });

    it('emits a lifecycle event', async () => {
      mod.datadogEvent('wizard.session.started', {
        integration: 'nextjs',
        ci: true,
      });
      await mod.flushDatadog();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, evtOpts] = fetchSpy.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      const body = JSON.parse(evtOpts.body as string) as Array<
        Record<string, unknown>
      >;
      const entry = body.find((e) => e.message === 'wizard.session.started');
      expect(entry).toBeDefined();
      expect(entry!.context).toMatchObject({
        event_name: 'wizard.session.started',
        integration: 'nextjs',
        ci: true,
      });
    });
  });

  describe('datadogError', () => {
    beforeEach(() => {
      process.env.DD_API_KEY = 'test-api-key-abc123xyz';
      mod.initDatadog({
        sessionId: 'test-session',
        version: '2.0.0',
        mode: 'interactive',
      });
    });

    it('emits an error with stack trace', async () => {
      const err = new Error('Something broke');
      mod.datadogError(err, { phase: 'detection' });
      await mod.flushDatadog();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, options] = fetchSpy.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      const body = JSON.parse(options.body as string) as Array<
        Record<string, unknown>
      >;
      const entry = body.find((e) => e.status === 'error');
      expect(entry).toBeDefined();
      expect(entry!.error).toMatchObject({
        kind: 'Error',
        message: 'Something broke',
      });
      expect((entry!.error as Record<string, unknown>).stack).toBeDefined();
    });
  });

  describe('PII redaction', () => {
    beforeEach(() => {
      process.env.DD_API_KEY = 'test-api-key-abc123xyz';
      mod.initDatadog({
        sessionId: 'test-session',
        version: '2.0.0',
        mode: 'interactive',
      });
    });

    it('redacts sensitive keys in context', async () => {
      mod.datadogLog('info', 'auth', 'user authenticated', {
        accessToken: 'secret-jwt-token',
        userId: 'user123',
      });
      await mod.flushDatadog();

      const [, options] = fetchSpy.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      const body = JSON.parse(options.body as string) as Array<
        Record<string, unknown>
      >;
      const entry = body.find((e) => e.message === 'user authenticated');
      expect(entry).toBeDefined();
      const ctx = entry!.context as Record<string, string>;
      expect(ctx.accessToken).toBe('[REDACTED]');
      expect(ctx.userId).toBe('user123');
    });

    it('redacts JWT patterns in string values', async () => {
      mod.datadogLog('info', 'auth', 'token check', {
        header:
          'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      });
      await mod.flushDatadog();

      const [, options] = fetchSpy.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      const body = JSON.parse(options.body as string) as Array<
        Record<string, unknown>
      >;
      const entry = body.find((e) => e.message === 'token check');
      expect(entry).toBeDefined();
      const ctx = entry!.context as Record<string, string>;
      expect(ctx.header).toContain('[REDACTED_JWT]');
      expect(ctx.header).not.toContain('eyJhbGci');
    });

    it('redacts home directory paths', async () => {
      mod.datadogLog('debug', 'fs', 'reading file', {
        path: '/Users/johndoe/projects/my-app/src/index.ts',
      });
      await mod.flushDatadog();

      const [, options] = fetchSpy.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      const body = JSON.parse(options.body as string) as Array<
        Record<string, unknown>
      >;
      const entry = body.find((e) => e.message === 'reading file');
      expect(entry).toBeDefined();
      const ctx = entry!.context as Record<string, string>;
      expect(ctx.path).toBe('[~]/...');
      expect(ctx.path).not.toContain('johndoe');
    });
  });

  describe('setDatadogTag', () => {
    it('adds custom tags to subsequent entries', async () => {
      process.env.DD_API_KEY = 'test-api-key-abc123xyz';
      mod.initDatadog({
        sessionId: 'test-session',
        version: '2.0.0',
        mode: 'interactive',
      });

      mod.setDatadogTag('integration', 'nextjs');
      mod.datadogLog('info', 'test', 'with tag');
      await mod.flushDatadog();

      const [, options] = fetchSpy.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      const body = JSON.parse(options.body as string) as Array<
        Record<string, unknown>
      >;
      const entry = body.find((e) => e.message === 'with tag');
      expect(entry).toBeDefined();
      expect(entry!.ddtags).toContain('integration:nextjs');
    });
  });

  describe('flush resilience', () => {
    it('does not throw when fetch fails', async () => {
      process.env.DD_API_KEY = 'test-api-key-abc123xyz';
      mod.initDatadog({
        sessionId: 'test-session',
        version: '2.0.0',
        mode: 'interactive',
      });

      fetchSpy.mockRejectedValueOnce(new Error('network error'));
      mod.datadogLog('info', 'test', 'will fail to flush');

      await expect(mod.flushDatadog()).resolves.toBeUndefined();
    });

    it('does not throw when fetch returns non-200', async () => {
      process.env.DD_API_KEY = 'test-api-key-abc123xyz';
      mod.initDatadog({
        sessionId: 'test-session',
        version: '2.0.0',
        mode: 'interactive',
      });

      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 403 }));
      mod.datadogLog('info', 'test', 'will get 403');

      await expect(mod.flushDatadog()).resolves.toBeUndefined();
    });

    it('no-ops flush when not initialized', async () => {
      await expect(mod.flushDatadog()).resolves.toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
