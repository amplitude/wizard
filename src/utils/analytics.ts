import { createInstance, Identify } from '@amplitude/analytics-node';
import type { WizardSession } from '../lib/wizard-session';
import { v4 as uuidv4 } from 'uuid';
import { debug } from './debug';
import { getSessionId, getRunId, setSentryUser } from '../lib/observability';
import {
  initFeatureFlags,
  refreshFlags,
  getFlag,
  getAllFlags,
  isFlagEnabled,
  FLAG_AGENT_ANALYTICS,
} from '../lib/feature-flags';

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
  /**
   * Session-scoped event properties — spread into every `capture()` call.
   *
   * Use for values that are genuinely session-wide and relevant to every event:
   *   mode, wizard_version, platform, node_version, integration, package-manager
   *
   * Do NOT use for step-specific state (vercel-detected, prettier-installed, etc.)
   * — pass those as event properties directly on the relevant event.
   */
  private sessionProperties: Record<
    string,
    string | boolean | number | null | undefined
  > = {};
  private distinctId?: string;
  private anonymousId: string;
  private appName = 'wizard';
  private activeFlags: Record<string, string> | null = null;
  private readonly client: ReturnType<typeof createInstance>;
  private initPromise: Promise<void> | null = null;
  private readonly startedAt = Date.now();

  constructor() {
    this.sessionProperties = { $app_name: this.appName };
    this.anonymousId = uuidv4();
    this.distinctId = undefined;
    this.client = createInstance();
  }

  /** Expose the anonymous device ID for cross-system correlation (logs, Sentry). */
  getAnonymousId(): string {
    return this.anonymousId;
  }

  setDistinctId(distinctId: string) {
    this.distinctId = distinctId;
    setSentryUser(distinctId);
  }

  /**
   * Send an identify call to associate user properties with the current user.
   * Call after setDistinctId() has been called with a valid email.
   */
  identifyUser(properties: {
    email?: string;
    org_id?: string;
    org_name?: string;
    workspace_id?: string;
    workspace_name?: string;
    project_id?: string | number | null;
    project_name?: string | null;
    region?: string | null;
    integration?: string | null;
  }): void {
    const apiKey = resolveTelemetryApiKey();
    if (!apiKey || !this.distinctId) {
      debug('identifyUser skipped (no API key or distinctId):', properties);
      return;
    }

    this.ensureInitStarted();

    const identifyObj = new Identify();

    if (properties.email) {
      identifyObj.setOnce('email', properties.email);
    }
    if (properties.org_id) identifyObj.set('org id', properties.org_id);
    if (properties.org_name) identifyObj.set('org name', properties.org_name);
    if (properties.workspace_id)
      identifyObj.set('workspace id', properties.workspace_id);
    if (properties.workspace_name)
      identifyObj.set('workspace name', properties.workspace_name);
    if (properties.project_id != null)
      identifyObj.set('project id', String(properties.project_id));
    if (properties.project_name)
      identifyObj.set('project name', properties.project_name);
    if (properties.region) identifyObj.set('region', properties.region);
    if (properties.integration)
      identifyObj.set('integration', properties.integration);

    const eventOptions = {
      device_id: this.anonymousId,
      user_id: this.distinctId,
    };

    this.client.identify(identifyObj, eventOptions);

    // Associate org-level group (matches main product convention)
    if (properties.org_id) {
      this.client.setGroup('org id', properties.org_id, eventOptions);

      const groupProps = new Identify();
      if (properties.org_name) groupProps.set('org name', properties.org_name);
      this.client.groupIdentify(
        'org id',
        properties.org_id,
        groupProps,
        eventOptions,
      );
    }

    debug('identifyUser:', properties);
  }

  /**
   * Set a session-scoped property that appears on every subsequent event.
   *
   * Only use for values relevant to ALL events in the session:
   *   mode, wizard_version, platform, node_version, integration, package-manager
   *
   * For step-specific data (vercel status, prettier, etc.), pass as event
   * properties directly on the relevant `wizardCapture()` call instead.
   */
  setSessionProperty(
    key: string,
    value: string | boolean | number | null | undefined,
  ) {
    this.sessionProperties[key] = value;
  }

  /**
   * @deprecated Use `setSessionProperty()` for session-wide data, or pass
   * step-specific data as event properties on `wizardCapture()`.
   */
  setTag(key: string, value: string | boolean | number | null | undefined) {
    this.sessionProperties[key] = value;
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
      ...this.sessionProperties,
      session_id: getSessionId(),
      run_id: getRunId(),
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
   * Capture a wizard-specific event. Automatically prepends "wizard: " to the event name.
   * All new wizard analytics should use this method instead of capture() directly.
   * Use lowercase with spaces for eventName (e.g. "agent started", "api key submitted")
   * per Amplitude quickstart taxonomy guidelines.
   */
  wizardCapture(eventName: string, properties?: Record<string, unknown>): void {
    this.capture(`wizard: ${eventName}`, properties);
  }

  /**
   * Apply feature-flag–based opt-out to the Amplitude SDK.
   * Defaults to ON — only opts out when `wizard-agent-analytics` is explicitly 'off'/'false'.
   */
  applyOptOut(): void {
    const flagValue = getFlag(FLAG_AGENT_ANALYTICS);
    const optOut = flagValue === 'off' || flagValue === 'false';
    this.client.setOptOut(optOut);
    if (optOut) {
      debug('analytics: opted out via wizard-agent-analytics flag');
    }
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
      flushQueueSize: 10,
      flushIntervalMillis: 1000,
    }).promise;
  }

  /**
   * Initialize the Amplitude Experiment feature-flag client.
   * Call once early in startup (e.g. after obtaining a user/device ID).
   */
  async initFlags(): Promise<void> {
    await initFeatureFlags(this.distinctId, this.anonymousId);
  }

  /**
   * Re-evaluate flags after the user identity changes (e.g. post-login).
   */
  async refreshFlags(): Promise<void> {
    await refreshFlags(this.distinctId, this.anonymousId);
    this.activeFlags = getAllFlags();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getFeatureFlag(flagKey: string): Promise<string | boolean | undefined> {
    return getFlag(flagKey);
  }

  /**
   * Check if a flag is enabled (variant is 'on' or 'true').
   */
  isFeatureFlagEnabled(flagKey: string): boolean {
    return isFlagEnabled(flagKey);
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
    this.activeFlags = getAllFlags();
    return this.activeFlags;
  }

  /**
   * Flush pending events without ending the session.
   * Use for mid-session flushes (e.g. feedback command) where
   * the wizard continues running after the flush.
   */
  async flush(): Promise<void> {
    if (this.initPromise === null) return;
    try {
      await this.initPromise;
      await this.client.flush().promise;
    } catch (err) {
      debug('analytics flush error:', err);
    }
  }

  async shutdown(status: 'success' | 'error' | 'cancelled') {
    this.wizardCapture('Session Ended', {
      status,
      session_duration_ms: Date.now() - this.startedAt,
    });
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
export const WIZARD_FEEDBACK_EVENT_TYPE = 'wizard: feedback submitted';

export const analytics = new Analytics();

/**
 * Unified wizard error telemetry (aligns with starter taxonomy “Error Encountered”).
 * Emits `wizard: error encountered` with category / message / context.
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
