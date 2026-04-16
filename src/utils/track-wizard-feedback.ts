import { analytics, resolveTelemetryApiKey } from './analytics.js';

/**
 * Send a single feedback event to Amplitude via the shared analytics singleton.
 * Uses the same device_id, session_id, and run_id as other wizard telemetry.
 *
 * Uses flush() (not shutdown()) so the session continues normally after
 * feedback is sent — avoids a spurious "Session Ended" event mid-session.
 */
export async function trackWizardFeedback(message: string): Promise<void> {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error('Feedback message cannot be empty');
  }
  if (!resolveTelemetryApiKey()) {
    throw new Error('Feedback cannot be sent');
  }
  analytics.wizardCapture('feedback submitted', { message: trimmed });
  await analytics.flush();
}
