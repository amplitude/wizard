import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockInit, mockTrack, mockFlush, mockCreateInstance } = vi.hoisted(
  () => {
    const mockInit = vi.fn(() => ({ promise: Promise.resolve() }));
    const mockTrack = vi.fn();
    const mockFlush = vi.fn(() => ({ promise: Promise.resolve() }));
    const mockCreateInstance = vi.fn(() => ({
      init: mockInit,
      track: mockTrack,
      flush: mockFlush,
    }));
    return { mockInit, mockTrack, mockFlush, mockCreateInstance };
  },
);

vi.mock('@amplitude/analytics-node', () => ({
  createInstance: mockCreateInstance,
}));

import { WIZARD_FEEDBACK_EVENT_TYPE } from '../analytics.js';
import { trackWizardFeedback } from '../track-wizard-feedback.js';

describe('trackWizardFeedback', () => {
  beforeEach(() => {
    mockCreateInstance.mockClear();
    mockInit.mockClear();
    mockTrack.mockClear();
    mockFlush.mockClear();
  });

  it('initializes the Node client, tracks Wizard: Feedback Submitted, and flushes', async () => {
    await trackWizardFeedback('  hello  ');

    expect(mockCreateInstance).toHaveBeenCalledTimes(1);
    expect(mockInit).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        serverUrl: expect.stringMatching(/\/2\/httpapi$/),
      }),
    );
    expect(mockTrack).toHaveBeenCalledWith(
      WIZARD_FEEDBACK_EVENT_TYPE,
      { message: 'hello' },
      expect.objectContaining({ device_id: expect.any(String) }),
    );
    expect(mockFlush).toHaveBeenCalledTimes(1);
  });

  it('rejects empty messages', async () => {
    await expect(trackWizardFeedback('   ')).rejects.toThrow(
      'Feedback message cannot be empty',
    );
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('rejects when AMPLITUDE_API_KEY is only whitespace', async () => {
    const prev = process.env.AMPLITUDE_API_KEY;
    process.env.AMPLITUDE_API_KEY = '  ';
    try {
      await expect(trackWizardFeedback('hi')).rejects.toThrow(
        /Feedback cannot be sent/,
      );
      expect(mockTrack).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) {
        delete process.env.AMPLITUDE_API_KEY;
      } else {
        process.env.AMPLITUDE_API_KEY = prev;
      }
    }
  });
});
