import { analytics } from './analytics.js';
import type { Diagnostics } from '../lib/diagnostics-collector.js';

/**
 * Send a single feedback event to Amplitude via the shared analytics singleton.
 * Uses the same device_id, session_id, and run_id as other wizard telemetry.
 *
 * Uses flush() (not shutdown()) so the session continues normally after
 * feedback is sent — avoids a spurious "Session Ended" event mid-session.
 *
 * When `diagnostics` is provided, the payload is attached as a structured
 * property. Callers must obtain explicit user consent before collecting
 * and passing diagnostics — see src/lib/diagnostics-collector.ts.
 */
export async function trackWizardFeedback(
  message: string,
  diagnostics?: Diagnostics,
): Promise<void> {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error('Feedback message cannot be empty');
  }
  const properties: Record<string, unknown> = {
    message: trimmed,
    'diagnostics included': Boolean(diagnostics),
  };
  if (diagnostics) {
    properties.diagnostics = diagnostics;
  }
  analytics.wizardCapture('feedback submitted', properties);
  await analytics.flush();
}
