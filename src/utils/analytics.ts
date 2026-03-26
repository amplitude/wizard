import type { WizardSession } from '../lib/wizard-session';
import { v4 as uuidv4 } from 'uuid';
import { debug } from './debug';

const AMPLITUDE_API_KEY =
  process.env.AMPLITUDE_API_KEY ?? 'e5a2c9bdffe949f7da77e6b481e118fa';
const AMPLITUDE_SERVER_URL =
  process.env.AMPLITUDE_SERVER_URL ?? 'https://api2.amplitude.com';

/**
 * Extract a standard property bag from the current session.
 * Used by store-level analytics and available for ad-hoc captures.
 */
export function sessionProperties(
  session: WizardSession,
): Record<string, unknown> {
  return {
    integration: session.integration,
    detected_framework: session.detectedFrameworkLabel,
    typescript: session.typescript,
    project_id: session.credentials?.projectId,
    discovered_features: session.discoveredFeatures,
    additional_features: session.additionalFeatureQueue,
    run_phase: session.runPhase,
  };
}

interface AmplitudeEvent {
  event_type: string;
  user_id?: string;
  device_id: string;
  event_properties?: Record<string, unknown>;
  user_properties?: Record<string, unknown>;
  time: number;
}

export class Analytics {
  private tags: Record<string, string | boolean | number | null | undefined> =
    {};
  private distinctId?: string;
  private anonymousId: string;
  private appName = 'wizard';
  private activeFlags: Record<string, string> | null = null;
  private pendingEvents: AmplitudeEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.tags = { $app_name: this.appName };
    this.anonymousId = uuidv4();
    this.distinctId = undefined;
  }

  setDistinctId(distinctId: string) {
    this.distinctId = distinctId;
  }

  setTag(key: string, value: string | boolean | number | null | undefined) {
    this.tags[key] = value;
  }

  captureException(error: Error, properties: Record<string, unknown> = {}) {
    this.capture('$error', {
      ...properties,
      error_message: error.message,
      error_name: error.name,
    });
  }

  capture(eventName: string, properties?: Record<string, unknown>) {
    if (!AMPLITUDE_API_KEY) {
      debug('capture (no API key):', eventName, properties);
      return;
    }

    const event: AmplitudeEvent = {
      event_type: eventName,
      device_id: this.anonymousId,
      time: Date.now(),
      event_properties: {
        ...this.tags,
        ...properties,
      },
    };

    if (this.distinctId) {
      event.user_id = this.distinctId;
    }

    this.pendingEvents.push(event);
    debug('capture:', eventName, properties);

    // Debounce flush to batch events
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      void this.flush();
    }, 500);
  }

  /**
   * Capture a wizard-specific event. Automatically prepends "wizard: " to the event name.
   * All new wizard analytics should use this method instead of capture() directly.
   */
  wizardCapture(eventName: string, properties?: Record<string, unknown>): void {
    this.capture(`wizard: ${eventName}`, properties);
  }

  private async flush(): Promise<void> {
    if (this.pendingEvents.length === 0) return;
    if (!AMPLITUDE_API_KEY) return;

    const events = [...this.pendingEvents];
    this.pendingEvents = [];

    try {
      const response = await fetch(`${AMPLITUDE_SERVER_URL}/2/httpapi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: AMPLITUDE_API_KEY, events }),
      });
      if (!response.ok) {
        debug(
          'Amplitude upload failed:',
          response.status,
          await response.text(),
        );
      }
    } catch (err) {
      debug('Amplitude upload error:', err);
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getFeatureFlag(flagKey: string): Promise<string | boolean | undefined> {
    debug('getFeatureFlag (noop):', flagKey);
    return undefined;
  }

  /**
   * Evaluate all feature flags for the current user at the start of a run.
   * Result is cached; subsequent calls in the same run return the same map.
   * Returns flag key -> string value (booleans become 'true'/'false').
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async getAllFlagsForWizard(): Promise<Record<string, string>> {
    if (this.activeFlags !== null) {
      return this.activeFlags;
    }
    this.activeFlags = {};
    return this.activeFlags;
  }

  async shutdown(status: 'success' | 'error' | 'cancelled') {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.capture('wizard: session ended', { status });
    await this.flush();
  }
}

export const analytics = new Analytics();
