import { createInstance } from '@amplitude/analytics-node';
import type { WizardSession } from '../lib/wizard-session';
import { v4 as uuidv4 } from 'uuid';
import { debug } from './debug';

const DEFAULT_TELEMETRY_API_KEY = 'e5a2c9bdffe949f7da77e6b481e118fa';

/**
 * Telemetry project API key. Empty or whitespace-only env value means “no key”
 * (use default only when the variable is unset).
 */
export function resolveTelemetryApiKey(): string {
  const fromEnv = process.env.AMPLITUDE_API_KEY;
  const raw = fromEnv !== undefined ? fromEnv : DEFAULT_TELEMETRY_API_KEY;
  return raw.trim();
}

/** HTTP API URL for `@amplitude/analytics-node` (same shape as manual HTTP ingest). */
export function getAmplitudeNodeServerUrl(): string {
  const base = process.env.AMPLITUDE_SERVER_URL ?? 'https://api2.amplitude.com';
  return `${base.replace(/\/$/, '')}/2/httpapi`;
}

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

/**
 * Smaller session bag for high-volume wizard events (taxonomy: keep event
 * properties chart-useful and within a small count).
 */
export function sessionPropertiesCompact(
  session: WizardSession,
): Record<string, unknown> {
  return {
    integration: session.integration,
    detected_framework: session.detectedFrameworkLabel,
    run_phase: session.runPhase,
    project_id: session.credentials?.projectId,
  };
}

export class Analytics {
  private tags: Record<string, string | boolean | number | null | undefined> =
    {};
  private distinctId?: string;
  private anonymousId: string;
  private appName = 'wizard';
  private activeFlags: Record<string, string> | null = null;
  private readonly client: ReturnType<typeof createInstance>;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.tags = { $app_name: this.appName };
    this.anonymousId = uuidv4();
    this.distinctId = undefined;
    this.client = createInstance();
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
    const apiKey = resolveTelemetryApiKey();
    if (!apiKey) {
      debug('capture (no API key):', eventName, properties);
      return;
    }

    this.ensureInitStarted();
    const eventProps = {
      ...this.tags,
      ...properties,
    };
    const options: { device_id: string; user_id?: string } = {
      device_id: this.anonymousId,
    };
    if (this.distinctId) {
      options.user_id = this.distinctId;
    }

    this.client.track(eventName, eventProps, options);
    debug('capture:', eventName, properties);
  }

  /**
   * Capture a wizard-specific event. Automatically prepends "Wizard: " to the event name.
   * All new wizard analytics should use this method instead of capture() directly.
   * Use Title Case with spaces for eventName (e.g. "Agent Started", "API Key Submitted")
   * per Amplitude quickstart taxonomy guidelines.
   */
  wizardCapture(eventName: string, properties?: Record<string, unknown>): void {
    this.capture(`Wizard: ${eventName}`, properties);
  }

  private ensureInitStarted(): void {
    if (this.initPromise !== null) {
      return;
    }
    const apiKey = resolveTelemetryApiKey();
    if (!apiKey) {
      return;
    }
    this.initPromise = this.client.init(apiKey, {
      serverUrl: getAmplitudeNodeServerUrl(),
    }).promise;
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
    this.wizardCapture('Session Ended', { status });
    if (this.initPromise === null) {
      return;
    }
    try {
      await this.initPromise;
      await this.client.flush().promise;
    } catch (err) {
      debug('analytics shutdown flush error:', err);
    }
  }
}

/**
 * Full Amplitude `event_type` for CLI/TUI product feedback.
 * Same string as `wizardCapture('Feedback Submitted', …)`.
 */
export const WIZARD_FEEDBACK_EVENT_TYPE = 'Wizard: Feedback Submitted';

export const analytics = new Analytics();

/**
 * Unified wizard error telemetry (aligns with starter taxonomy “Error Encountered”).
 * Emits `Wizard: Error Encountered` with category / message / context.
 */
export function captureWizardError(
  errorCategory: string,
  errorMessage: string,
  errorContext: string,
  extra?: Record<string, unknown>,
): void {
  analytics.wizardCapture('Error Encountered', {
    error_category: errorCategory,
    error_message: errorMessage,
    error_context: errorContext,
    ...extra,
  });
}
