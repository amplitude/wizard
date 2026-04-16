import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockWizardCapture, mockFlush, mockResolveTelemetryApiKey } = vi.hoisted(
  () => {
    return {
      mockWizardCapture: vi.fn(),
      mockFlush: vi.fn().mockResolvedValue(undefined),
      mockResolveTelemetryApiKey: vi.fn().mockReturnValue('test-api-key'),
    };
  },
);

vi.mock('../analytics.js', () => ({
  analytics: {
    wizardCapture: mockWizardCapture,
    flush: mockFlush,
  },
  resolveTelemetryApiKey: mockResolveTelemetryApiKey,
}));

import { trackWizardFeedback } from '../track-wizard-feedback.js';

describe('trackWizardFeedback', () => {
  beforeEach(() => {
    mockWizardCapture.mockClear();
    mockFlush.mockClear();
    mockResolveTelemetryApiKey.mockReturnValue('test-api-key');
  });

  it('captures feedback via the analytics singleton and flushes', async () => {
    await trackWizardFeedback('  hello  ');

    expect(mockWizardCapture).toHaveBeenCalledWith('feedback submitted', {
      message: 'hello',
    });
    expect(mockFlush).toHaveBeenCalled();
  });

  it('rejects empty messages', async () => {
    await expect(trackWizardFeedback('   ')).rejects.toThrow(
      'Feedback message cannot be empty',
    );
    expect(mockWizardCapture).not.toHaveBeenCalled();
  });

  it('throws when telemetry API key is missing', async () => {
    mockResolveTelemetryApiKey.mockReturnValue('');
    await expect(trackWizardFeedback('hello')).rejects.toThrow(
      'Feedback cannot be sent',
    );
    expect(mockWizardCapture).not.toHaveBeenCalled();
  });
});
