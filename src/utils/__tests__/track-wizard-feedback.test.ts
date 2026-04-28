import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockWizardCapture, mockFlush } = vi.hoisted(() => {
  return {
    mockWizardCapture: vi.fn(),
    mockFlush: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../analytics.js', () => ({
  analytics: {
    wizardCapture: mockWizardCapture,
    flush: mockFlush,
  },
}));

import { trackWizardFeedback } from '../track-wizard-feedback.js';

describe('trackWizardFeedback', () => {
  beforeEach(() => {
    mockWizardCapture.mockClear();
    mockFlush.mockClear();
  });

  it('captures feedback via the analytics singleton and flushes', async () => {
    await trackWizardFeedback('  hello  ');

    expect(mockWizardCapture).toHaveBeenCalledWith('feedback submitted', {
      message: 'hello',
      'diagnostics included': false,
    });
    // Uses flush() not shutdown() — avoids spurious "Session Ended" mid-session
    expect(mockFlush).toHaveBeenCalled();
  });

  it('rejects empty messages', async () => {
    await expect(trackWizardFeedback('   ')).rejects.toThrow(
      'Feedback message cannot be empty',
    );
    expect(mockWizardCapture).not.toHaveBeenCalled();
  });

  it('attaches diagnostics payload when provided', async () => {
    const diagnostics = { schema_version: 1, collected_at: 'now' } as never;
    await trackWizardFeedback('hello', diagnostics);

    expect(mockWizardCapture).toHaveBeenCalledWith('feedback submitted', {
      message: 'hello',
      'diagnostics included': true,
      diagnostics,
    });
  });
});
