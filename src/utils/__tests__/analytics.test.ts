import { type MockedFunction } from 'vitest';

const { mockCreateInstance } = vi.hoisted(() => {
  const mockCreateInstance = vi.fn(() => ({
    init: vi.fn(() => ({ promise: Promise.resolve() })),
    track: vi.fn(),
    flush: vi.fn(() => ({ promise: Promise.resolve() })),
  }));
  return { mockCreateInstance };
});

vi.mock('@amplitude/analytics-node', () => ({
  createInstance: mockCreateInstance,
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid'),
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

  describe('setTag', () => {
    it('should not throw when setting tags', () => {
      expect(() => analytics.setTag('integration', 'nextjs')).not.toThrow();
    });
  });

  describe('getFeatureFlag', () => {
    it('should return undefined (stub)', async () => {
      const result = await analytics.getFeatureFlag('some-flag');
      expect(result).toBeUndefined();
    });
  });

  describe('getAllFlagsForWizard', () => {
    it('should return empty object (stub)', async () => {
      const result = await analytics.getAllFlagsForWizard();
      expect(result).toEqual({});
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
});
