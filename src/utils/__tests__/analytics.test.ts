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

import { Analytics } from '../analytics.js';

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
  });

  describe('wizardCapture', () => {
    it('should not throw when capturing wizard events', () => {
      expect(() => analytics.wizardCapture('test event')).not.toThrow();
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
