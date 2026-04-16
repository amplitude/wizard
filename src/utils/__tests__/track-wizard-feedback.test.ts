import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockWizardCapture, mockShutdown } = vi.hoisted(() => {
  return {
    mockWizardCapture: vi.fn(),
    mockShutdown: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../analytics.js', () => ({
  analytics: {
    wizardCapture: mockWizardCapture,
    shutdown: mockShutdown,
  },
}));

import { trackWizardFeedback } from '../track-wizard-feedback.js';

describe('trackWizardFeedback', () => {
  beforeEach(() => {
    mockWizardCapture.mockClear();
    mockShutdown.mockClear();
  });

  it('captures feedback via the analytics singleton and flushes', async () => {
    await trackWizardFeedback('  hello  ');

    expect(mockWizardCapture).toHaveBeenCalledWith('feedback submitted', {
      message: 'hello',
    });
    expect(mockShutdown).toHaveBeenCalledWith('success');
  });

  it('rejects empty messages', async () => {
    await expect(trackWizardFeedback('   ')).rejects.toThrow(
      'Feedback message cannot be empty',
    );
    expect(mockWizardCapture).not.toHaveBeenCalled();
  });
});
