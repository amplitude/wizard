import { analytics } from './analytics.js';

/**
 * Send a single feedback event to Amplitude via the shared analytics singleton.
 * Uses the same device_id, session_id, and run_id as other wizard telemetry.
 */
export async function trackWizardFeedback(message: string): Promise<void> {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error('Feedback message cannot be empty');
  }
  analytics.wizardCapture('feedback submitted', { message: trimmed });
  await analytics.shutdown('success');
}
