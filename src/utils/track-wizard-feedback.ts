import { createInstance } from '@amplitude/analytics-node';
import { v4 as uuidv4 } from 'uuid';

import {
  WIZARD_FEEDBACK_EVENT_TYPE,
  getAmplitudeNodeServerUrl,
  resolveTelemetryApiKey,
} from './analytics.js';

/**
 * Send a single feedback event to Amplitude via the Node SDK.
 * Uses the same API key and server URL as other wizard telemetry.
 */
export async function trackWizardFeedback(message: string): Promise<void> {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error('Feedback message cannot be empty');
  }
  const apiKey = resolveTelemetryApiKey();
  if (!apiKey) {
    throw new Error(
      'Feedback cannot be sent: set AMPLITUDE_API_KEY or unset it to use the default telemetry project.',
    );
  }

  const client = createInstance();
  await client.init(apiKey, { serverUrl: getAmplitudeNodeServerUrl() }).promise;
  const deviceId = uuidv4();
  client.track(
    WIZARD_FEEDBACK_EVENT_TYPE,
    { message: trimmed },
    { device_id: deviceId },
  );
  await client.flush().promise;
}
