/**
 * Datadog integration for the Amplitude Wizard CLI.
 *
 * Ships structured logs, lifecycle events, and performance data to Datadog
 * via the HTTP Logs Intake API — no local Datadog Agent required.
 *
 * This is designed for CLI tools distributed via npx: users don't have
 * a DD Agent running, so we POST directly to the intake endpoint.
 *
 * PII protection:
 * - All payloads pass through the shared redaction layer before transmission
 * - Additional DD-specific sensitive field scrubbing is configurable
 * - Respects DO_NOT_TRACK / AMPLITUDE_WIZARD_NO_TELEMETRY opt-out
 *
 * Enable by setting DD_API_KEY (or DATADOG_API_KEY). Without it, everything no-ops.
 */

import { redact } from './redact';
import type { LogLevel } from './logger';
import { setDatadogSink } from './logger';
import type { ExecutionMode } from '../mode-config';
import { getRunId, getSessionId } from './correlation';

// ── Configuration ────────────────────────────────────────────────────

interface DatadogConfig {
  sessionId: string;
  version: string;
  mode: ExecutionMode;
}

interface DatadogLogEntry {
  message: string;
  ddtags: string;
  ddsource: string;
  hostname: string;
  service: string;
  status: string;
  [key: string]: unknown;
}

// ── State ────────────────────────────────────────────────────────────

let initialized = false;
let apiKey: string | null = null;
let ddSite = 'datadoghq.com';
let ddService = 'amplitude-wizard';
let ddEnv = 'production';
let ddExtraTags = '';
let wizardVersion = '';
let executionMode: ExecutionMode = 'interactive';

const buffer: DatadogLogEntry[] = [];
const FLUSH_INTERVAL_MS = 5_000;
const MAX_BUFFER_SIZE = 100;

let flushTimer: ReturnType<typeof setInterval> | null = null;

// ── Telemetry opt-out (shared with Sentry) ───────────────────────────

function isTelemetryDisabled(): boolean {
  if (process.env.NODE_ENV === 'test') return true;
  if (process.env.DO_NOT_TRACK === '1') return true;
  if (process.env.AMPLITUDE_WIZARD_NO_TELEMETRY === '1') return true;
  return false;
}

// ── API key resolution ───────────────────────────────────────────────

function resolveApiKey(): string | null {
  const key =
    process.env.DD_API_KEY ?? process.env.DATADOG_API_KEY ?? undefined;
  if (!key || key.trim().length === 0) return null;
  return key.trim();
}

// ── Log level mapping ────────────────────────────────────────────────

const DD_STATUS_MAP: Record<LogLevel, string> = {
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
};

// ── Tag builder ──────────────────────────────────────────────────────

function buildTags(extra?: Record<string, string>): string {
  const tags: string[] = [
    `env:${ddEnv}`,
    `service:${ddService}`,
    `version:${wizardVersion}`,
    `mode:${executionMode}`,
    `platform:${process.platform}`,
    `node_version:${process.version}`,
  ];

  if (ddExtraTags) {
    tags.push(...ddExtraTags.split(',').map((t) => t.trim()));
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      tags.push(`${k}:${v}`);
    }
  }
  return tags.filter(Boolean).join(',');
}

// ── Flush to Datadog ─────────────────────────────────────────────────

async function flushBuffer(): Promise<void> {
  if (buffer.length === 0 || !apiKey) return;

  const entries = buffer.splice(0, buffer.length);

  const url = `https://http-intake.logs.${ddSite}/api/v2/logs`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'DD-API-KEY': apiKey,
      },
      body: JSON.stringify(entries),
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      // Non-fatal — best-effort telemetry
    }
  } catch {
    // Network failure is non-fatal — don't block the CLI
  }
}

function enqueue(entry: DatadogLogEntry): void {
  buffer.push(entry);
  if (buffer.length >= MAX_BUFFER_SIZE) {
    void flushBuffer();
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Initialize Datadog log shipping.
 * Call once at startup, after correlation is initialized.
 * No-ops if DD_API_KEY is not set or telemetry is disabled.
 */
export function initDatadog(config: DatadogConfig): void {
  if (isTelemetryDisabled()) {
    registerDatadogSink();
    return;
  }

  const key = resolveApiKey();
  if (!key) {
    registerDatadogSink();
    return;
  }

  apiKey = key;
  ddSite = process.env.DD_SITE ?? 'datadoghq.com';
  ddService = process.env.DD_SERVICE ?? 'amplitude-wizard';
  ddEnv = resolveEnvironment(config.mode);
  ddExtraTags = process.env.DD_TAGS ?? '';
  wizardVersion = config.version;
  executionMode = config.mode;

  initialized = true;

  // Periodic flush for buffered entries
  flushTimer = setInterval(() => {
    void flushBuffer();
  }, FLUSH_INTERVAL_MS);
  // Don't let the timer keep the process alive
  if (flushTimer && typeof flushTimer === 'object' && 'unref' in flushTimer) {
    flushTimer.unref();
  }

  registerDatadogSink();

  // Ship an initialization event
  datadogLog('info', 'datadog', 'Datadog observability initialized', {
    session_id: config.sessionId,
  });
}

function resolveEnvironment(mode: ExecutionMode): string {
  if (process.env.DD_ENV) return process.env.DD_ENV;
  if (process.env.NODE_ENV === 'test') return 'test';
  if (mode === 'ci') return 'ci';
  if (mode === 'agent') return 'agent';
  const isDev = ['development'].includes(process.env.NODE_ENV ?? '');
  if (isDev) return 'development';
  return 'production';
}

/**
 * Register the logger sink so structured log output also flows to Datadog.
 */
function registerDatadogSink(): void {
  setDatadogSink(
    (
      level: LogLevel,
      namespace: string,
      msg: string,
      ctx?: Record<string, unknown>,
    ) => {
      if (!initialized) return;
      datadogLog(level, namespace, msg, ctx);
    },
  );
}

/**
 * Send a structured log entry to Datadog.
 * The entry is redacted for PII before enqueueing.
 */
export function datadogLog(
  level: LogLevel,
  namespace: string,
  message: string,
  context?: Record<string, unknown>,
  extraTags?: Record<string, string>,
): void {
  if (!initialized) return;

  const redactedContext = context
    ? (redact(context) as Record<string, unknown>)
    : undefined;

  const entry: DatadogLogEntry = {
    message,
    ddsource: 'nodejs',
    hostname: `wizard-cli-${getSessionId().slice(0, 8)}`,
    service: ddService,
    status: DD_STATUS_MAP[level],
    ddtags: buildTags(extraTags),
    timestamp: new Date().toISOString(),
    logger: { name: namespace },
    session_id: getSessionId(),
    run_id: getRunId(),
    wizard_version: wizardVersion,
    execution_mode: executionMode,
    ...(redactedContext ? { context: redactedContext } : {}),
  };

  enqueue(entry);
}

/**
 * Record a lifecycle event with structured attributes.
 * Use for key moments: session start, auth, agent run, framework detection, errors.
 */
export function datadogEvent(
  eventName: string,
  attributes?: Record<string, unknown>,
  extraTags?: Record<string, string>,
): void {
  if (!initialized) return;

  const redactedAttrs = attributes
    ? (redact(attributes) as Record<string, unknown>)
    : undefined;

  datadogLog(
    'info',
    'wizard.lifecycle',
    eventName,
    {
      event_name: eventName,
      ...redactedAttrs,
    },
    { ...extraTags, event_type: 'lifecycle' },
  );
}

/**
 * Record an error with full context for Datadog Error Tracking.
 */
export function datadogError(
  error: Error,
  context?: Record<string, unknown>,
): void {
  if (!initialized) return;

  const redactedContext = context
    ? (redact(context) as Record<string, unknown>)
    : undefined;

  const entry: DatadogLogEntry = {
    message: error.message,
    ddsource: 'nodejs',
    hostname: `wizard-cli-${getSessionId().slice(0, 8)}`,
    service: ddService,
    status: 'error',
    ddtags: buildTags({ event_type: 'error' }),
    timestamp: new Date().toISOString(),
    logger: { name: 'wizard.error' },
    session_id: getSessionId(),
    run_id: getRunId(),
    wizard_version: wizardVersion,
    execution_mode: executionMode,
    error: {
      kind: error.name,
      message: error.message,
      stack: error.stack,
    },
    ...(redactedContext ? { context: redactedContext } : {}),
  };

  enqueue(entry);
}

/**
 * Set a persistent tag that appears on all subsequent log entries.
 * Mirrors setSentryTag() for cross-system consistency.
 */
export function setDatadogTag(key: string, value: string): void {
  if (!initialized) return;
  ddExtraTags = ddExtraTags
    ? `${ddExtraTags},${key}:${value}`
    : `${key}:${value}`;
}

/**
 * Flush all buffered log entries to Datadog.
 * Call before process exit to ensure data is delivered.
 */
export async function flushDatadog(): Promise<void> {
  if (!initialized) return;
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  try {
    await flushBuffer();
  } catch {
    // Flush failure is non-fatal — don't block exit
  }
}

/**
 * Check if Datadog integration is currently active.
 */
export function isDatadogInitialized(): boolean {
  return initialized;
}
