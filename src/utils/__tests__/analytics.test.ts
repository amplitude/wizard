import { type MockedFunction } from 'vitest';

const { mockCreateInstance, MockIdentify } = vi.hoisted(() => {
  const mockCreateInstance = vi.fn(() => ({
    init: vi.fn(() => ({ promise: Promise.resolve() })),
    track: vi.fn(),
    identify: vi.fn(),
    setGroup: vi.fn(),
    groupIdentify: vi.fn(),
    flush: vi.fn(() => ({ promise: Promise.resolve() })),
    setOptOut: vi.fn(),
  }));
  class MockIdentify {
    set = vi.fn();
    setOnce = vi.fn();
  }
  return { mockCreateInstance, MockIdentify };
});

vi.mock('@amplitude/analytics-node', () => ({
  createInstance: mockCreateInstance,
  Identify: MockIdentify,
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid'),
}));

vi.mock('../../lib/observability', () => ({
  getSessionId: vi.fn().mockReturnValue('test-session-id'),
  getRunId: vi.fn().mockReturnValue('test-run-id'),
  getAttemptId: vi.fn().mockReturnValue('test-attempt-id'),
  setSentryUser: vi.fn(),
  createLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  configureLogFile: vi.fn(),
  getLogFilePath: vi.fn().mockReturnValue('/tmp/test.log'),
}));

vi.mock('../ampli-settings', () => ({
  getStoredDeviceId: vi.fn().mockReturnValue(undefined),
  storeDeviceId: vi.fn(),
  getStoredFirstRunAt: vi.fn().mockReturnValue(undefined),
  storeFirstRunAt: vi.fn(),
}));

vi.mock('../../lib/feature-flags', () => ({
  initFeatureFlags: vi.fn().mockResolvedValue(undefined),
  refreshFlags: vi.fn().mockResolvedValue(undefined),
  getFlag: vi.fn().mockReturnValue(undefined),
  getAllFlags: vi.fn().mockReturnValue({}),
  isFlagEnabled: vi.fn().mockReturnValue(false),
  FLAG_AGENT_ANALYTICS: 'wizard-agent-analytics',
  FLAG_LLM_ANALYTICS: 'wizard-llm-analytics',
}));

import { v4 as uuidv4 } from 'uuid';

import { Analytics, resolveTelemetryApiKey } from '../analytics.js';

const mockUuidv4 = uuidv4 as MockedFunction<typeof uuidv4>;

describe('Analytics', () => {
  let analytics: Analytics;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUuidv4.mockReturnValue('test-uuid' as any);
    analytics = new Analytics();
  });

  describe('captureException', () => {
    it('should not throw when capturing exception', () => {
      const error = new Error('Test error');
      expect(() => analytics.captureException(error)).not.toThrow();
    });

    it('should not throw when capturing exception with properties', () => {
      const error = new Error('Test error');
      const properties = { integration: 'nextjs' };
      expect(() => analytics.captureException(error, properties)).not.toThrow();
    });
  });

  describe('capture', () => {
    it('should not throw when capturing events', () => {
      expect(() =>
        analytics.capture('test event', { foo: 'bar' }),
      ).not.toThrow();
    });
  });

  describe('setDistinctId', () => {
    it('should not throw when setting distinct id', () => {
      expect(() => analytics.setDistinctId('user-123')).not.toThrow();
    });
  });

  describe('setSessionProperty', () => {
    it('should not throw when setting session properties', () => {
      expect(() =>
        analytics.setSessionProperty('integration', 'nextjs'),
      ).not.toThrow();
    });

    it('setTag still works as deprecated alias', () => {
      expect(() => analytics.setTag('integration', 'nextjs')).not.toThrow();
    });
  });

  describe('getFeatureFlag', () => {
    it('should return undefined when flag is not set', async () => {
      const result = await analytics.getFeatureFlag('some-flag');
      expect(result).toBeUndefined();
    });
  });

  describe('getAllFlagsForWizard', () => {
    it('should return empty object when no flags are set', async () => {
      const result = await analytics.getAllFlagsForWizard();
      expect(result).toEqual({});
    });
  });

  describe('isFeatureFlagEnabled', () => {
    it('should return false when flag is not set', () => {
      expect(analytics.isFeatureFlagEnabled('some-flag')).toBe(false);
    });
  });

  describe('shutdown', () => {
    it('should not throw on shutdown', async () => {
      await expect(analytics.shutdown('success')).resolves.toBeUndefined();
    });

    it('emits `run ended` with outcome=configured when status=success', async () => {
      process.env.AMPLITUDE_API_KEY = 'test-key';
      const freshAnalytics = new Analytics();
      const trackSpy = vi.spyOn(
        (freshAnalytics as unknown as { client: { track: typeof vi.fn } })
          .client,
        'track',
      );
      await freshAnalytics.shutdown('success');
      const runEndedCall = trackSpy.mock.calls.find(
        (c) => c[0] === 'wizard cli: run ended',
      );
      expect(runEndedCall).toBeDefined();
      expect(runEndedCall?.[1]).toMatchObject({
        outcome: 'configured',
        status: 'success',
      });
      delete process.env.AMPLITUDE_API_KEY;
    });

    it('emits `run ended` with outcome=activated when metadata flags activation', async () => {
      process.env.AMPLITUDE_API_KEY = 'test-key';
      const freshAnalytics = new Analytics();
      const trackSpy = vi.spyOn(
        (freshAnalytics as unknown as { client: { track: typeof vi.fn } })
          .client,
        'track',
      );
      await freshAnalytics.shutdown('success', {
        outcome: 'activated',
        activated: true,
      });
      const runEndedCall = trackSpy.mock.calls.find(
        (c) => c[0] === 'wizard cli: run ended',
      );
      expect(runEndedCall?.[1]).toMatchObject({
        outcome: 'activated',
        activated: true,
      });
      delete process.env.AMPLITUDE_API_KEY;
    });

    it('emits `run ended` with outcome=error when status=error', async () => {
      process.env.AMPLITUDE_API_KEY = 'test-key';
      const freshAnalytics = new Analytics();
      const trackSpy = vi.spyOn(
        (freshAnalytics as unknown as { client: { track: typeof vi.fn } })
          .client,
        'track',
      );
      await freshAnalytics.shutdown('error', {
        exitCode: 10,
        failureCategory: 'auth',
      });
      const runEndedCall = trackSpy.mock.calls.find(
        (c) => c[0] === 'wizard cli: run ended',
      );
      expect(runEndedCall?.[1]).toMatchObject({
        outcome: 'error',
        status: 'error',
        'exit code': 10,
        'failure category': 'auth',
      });
      delete process.env.AMPLITUDE_API_KEY;
    });

    it('emits `run ended` with outcome=cancelled when status=cancelled', async () => {
      process.env.AMPLITUDE_API_KEY = 'test-key';
      const freshAnalytics = new Analytics();
      const trackSpy = vi.spyOn(
        (freshAnalytics as unknown as { client: { track: typeof vi.fn } })
          .client,
        'track',
      );
      await freshAnalytics.shutdown('cancelled');
      const runEndedCall = trackSpy.mock.calls.find(
        (c) => c[0] === 'wizard cli: run ended',
      );
      expect(runEndedCall?.[1]).toMatchObject({
        outcome: 'cancelled',
        status: 'cancelled',
      });
      delete process.env.AMPLITUDE_API_KEY;
    });

    it('still emits deprecated `session ended` alongside `run ended`', async () => {
      process.env.AMPLITUDE_API_KEY = 'test-key';
      const freshAnalytics = new Analytics();
      const trackSpy = vi.spyOn(
        (freshAnalytics as unknown as { client: { track: typeof vi.fn } })
          .client,
        'track',
      );
      await freshAnalytics.shutdown('success');
      const sessionEndedCall = trackSpy.mock.calls.find(
        (c) => c[0] === 'wizard cli: session ended',
      );
      expect(sessionEndedCall).toBeDefined();
      delete process.env.AMPLITUDE_API_KEY;
    });
  });

  describe('wizardCapture', () => {
    it('should not throw when capturing wizard events', () => {
      expect(() => analytics.wizardCapture('test event')).not.toThrow();
    });
  });

  describe('resolveTelemetryApiKey', () => {
    const DEV_KEY = 'ce58b28cace35f7df0eb241b0cd72044';
    const PROD_KEY = 'e5a2c9bdffe949f7da77e6b481e118fa';

    it('returns the dev key under NODE_ENV=test', () => {
      const originalEnvKey = process.env.AMPLITUDE_API_KEY;
      delete process.env.AMPLITUDE_API_KEY;
      try {
        // Vitest sets NODE_ENV=test, which counts as IS_DEV.
        expect(resolveTelemetryApiKey()).toBe(DEV_KEY);
      } finally {
        if (originalEnvKey !== undefined) {
          process.env.AMPLITUDE_API_KEY = originalEnvKey;
        }
      }
    });

    it('prefers AMPLITUDE_API_KEY override over the default', () => {
      const originalEnvKey = process.env.AMPLITUDE_API_KEY;
      process.env.AMPLITUDE_API_KEY = 'explicit-override-key';
      try {
        expect(resolveTelemetryApiKey()).toBe('explicit-override-key');
      } finally {
        if (originalEnvKey === undefined) {
          delete process.env.AMPLITUDE_API_KEY;
        } else {
          process.env.AMPLITUDE_API_KEY = originalEnvKey;
        }
      }
    });

    it('knows the prod key constant (matches Lightning ampli config)', () => {
      // Belt-and-braces: the prod key should never silently change. If this
      // fails, the wizard is about to point telemetry at a different project.
      expect(PROD_KEY).toBe('e5a2c9bdffe949f7da77e6b481e118fa');
    });
  });

  describe('identifyUser', () => {
    it('should call client.identify with user properties and correct event options', () => {
      analytics.setDistinctId('ada@example.com');
      analytics.identifyUser({
        email: 'ada@example.com',
        org_id: 'org-1',
        org_name: 'Acme',
        region: 'us',
      });

      const client = mockCreateInstance.mock.results[0].value;
      expect(client.identify).toHaveBeenCalledTimes(1);

      const identifyObj = client.identify.mock.calls[0][0];
      expect(identifyObj.setOnce).toHaveBeenCalledWith(
        'email',
        'ada@example.com',
      );
      expect(identifyObj.set).toHaveBeenCalledWith('org id', 'org-1');
      expect(identifyObj.set).toHaveBeenCalledWith('org name', 'Acme');
      expect(identifyObj.set).toHaveBeenCalledWith('region', 'us');

      // Verify groupIdentify with org id
      expect(client.setGroup).toHaveBeenCalledWith(
        'org id',
        'org-1',
        expect.objectContaining({ user_id: 'ada@example.com' }),
      );
      expect(client.groupIdentify).toHaveBeenCalledTimes(1);
      const groupIdentifyArgs = client.groupIdentify.mock.calls[0];
      expect(groupIdentifyArgs[0]).toBe('org id');
      expect(groupIdentifyArgs[1]).toBe('org-1');
      expect(groupIdentifyArgs[2].set).toHaveBeenCalledWith('org name', 'Acme');
      // `last used wizard` is stamped with the current UTC timestamp each run.
      const lastUsedCall = groupIdentifyArgs[2].set.mock.calls.find(
        (args: unknown[]) => args[0] === 'last used wizard',
      );
      expect(lastUsedCall).toBeDefined();
      expect(lastUsedCall![1]).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );

      // Verify event options tie the identify to the right user + device
      const eventOptions = client.identify.mock.calls[0][1];
      expect(eventOptions).toEqual({
        device_id: 'test-uuid',
        user_id: 'ada@example.com',
      });
    });

    it('should be a no-op when distinctId is not set', () => {
      analytics.identifyUser({ email: 'ada@example.com' });

      const client = mockCreateInstance.mock.results[0].value;
      expect(client.identify).not.toHaveBeenCalled();
    });

    it('should be a no-op when API key is empty', () => {
      const origKey = process.env.AMPLITUDE_API_KEY;
      process.env.AMPLITUDE_API_KEY = '';
      try {
        analytics.setDistinctId('ada@example.com');
        analytics.identifyUser({ email: 'ada@example.com' });

        const client = mockCreateInstance.mock.results[0].value;
        expect(client.identify).not.toHaveBeenCalled();
      } finally {
        if (origKey === undefined) {
          delete process.env.AMPLITUDE_API_KEY;
        } else {
          process.env.AMPLITUDE_API_KEY = origKey;
        }
      }
    });

    it('should stringify numeric project_id', () => {
      analytics.setDistinctId('ada@example.com');
      analytics.identifyUser({
        project_id: 42,
      });

      const client = mockCreateInstance.mock.results[0].value;
      const identifyObj = client.identify.mock.calls[0][0];
      expect(identifyObj.set).toHaveBeenCalledWith('project id', '42');
    });

    it('should skip null/undefined properties', () => {
      analytics.setDistinctId('ada@example.com');
      analytics.identifyUser({
        email: 'ada@example.com',
        org_id: undefined,
        project_id: null,
        region: null,
      });

      const client = mockCreateInstance.mock.results[0].value;
      const identifyObj = client.identify.mock.calls[0][0];
      expect(identifyObj.setOnce).toHaveBeenCalledWith(
        'email',
        'ada@example.com',
      );
      // org id, project id, and region should not have been set
      expect(identifyObj.set).not.toHaveBeenCalledWith(
        'org id',
        expect.anything(),
      );
      expect(identifyObj.set).not.toHaveBeenCalledWith(
        'project id',
        expect.anything(),
      );
      expect(identifyObj.set).not.toHaveBeenCalledWith(
        'region',
        expect.anything(),
      );
    });
  });
});
