// TODO: Replace with Amplitude analytics. Amplitude telemetry has been stubbed out.
import type { WizardSession } from '../lib/wizard-session';
import { v4 as uuidv4 } from 'uuid';
import { debug } from './debug';

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

export class Analytics {
  private tags: Record<string, string | boolean | number | null | undefined> =
    {};
  private distinctId?: string;
  private anonymousId: string;
  private appName = 'wizard';
  private activeFlags: Record<string, string> | null = null;

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
    // TODO: Replace with Amplitude error tracking
    debug('captureException (noop):', error.message, properties);
  }

  capture(eventName: string, properties?: Record<string, unknown>) {
    // TODO: Replace with Amplitude event tracking
    debug('capture (noop):', eventName, properties);
  }

  /**
   * Capture a wizard-specific event. Automatically prepends "wizard: " to the event name.
   * All new wizard analytics should use this method instead of capture() directly.
   */
  wizardCapture(eventName: string, properties?: Record<string, unknown>): void {
    this.capture(`wizard: ${eventName}`, properties);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getFeatureFlag(flagKey: string): Promise<string | boolean | undefined> {
    // TODO: Replace with Amplitude feature flag evaluation
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
    // TODO: Replace with Amplitude feature flags
    if (this.activeFlags !== null) {
      return this.activeFlags;
    }
    this.activeFlags = {};
    return this.activeFlags;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async shutdown(status: 'success' | 'error' | 'cancelled') {
    // TODO: Replace with Amplitude shutdown/flush
    debug('shutdown (noop):', status);
  }
}

export const analytics = new Analytics();
