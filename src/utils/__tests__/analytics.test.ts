// TODO: Update analytics tests when Amplitude analytics is implemented.
// The PostHog-based analytics has been replaced with a stub.
import { Analytics } from '../analytics';
import { v4 as uuidv4 } from 'uuid';

jest.mock('uuid');

const mockUuidv4 = uuidv4 as jest.MockedFunction<typeof uuidv4>;

describe('Analytics', () => {
  let analytics: Analytics;

  beforeEach(() => {
    jest.clearAllMocks();
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
