import * as Sentry from '@sentry/node';
import type { LogLevel } from './logger';
import { setSentrySink } from './logger';
import { redact, redactString } from './redact';
import type { ExecutionMode } from '../mode-config';

// classifyError is in an ESM module — lazy-import to avoid CJS/ESM conflict.
interface ClassifiedError {
  message: string;
  suggestion: string;
  docsUrl?: string;
  retryable: boolean;
}
type ClassifyErrorFn = (err: unknown) => ClassifiedError;

const defaultClassify: ClassifyErrorFn = (err: unknown) => ({
  message: err instanceof Error ? err.message : String(err),
  suggestion: '',
  retryable: false,
});

let _classifyError: ClassifyErrorFn | null = null;
function getClassifyError(): ClassifyErrorFn {
  if (!_classifyError) {
    try {
      const mod = require('../../ui/tui/utils/classify-error') as {
        classifyError: ClassifyErrorFn;
      };
      _classifyError = mod.classifyError;
    } catch {
      _classifyError = defaultClassify;
    }
  }
  return _classifyError;
}

// ── Constants ───────────────────────────────────────────────────────

const WIZARD_SENTRY_DSN =
  'https://a4903445ee63441d8c779ba43a7d9b86@o13027.ingest.us.sentry.io/4511226225229825';

// ── Types ───────────────────────────────────────────────────────────

export interface SentryConfig {
  sessionId: string;
  version: string;
  mode: ExecutionMode;
  debug: boolean;
}

// ── State ───────────────────────────────────────────────────────────

let initialized = false;

// ── Telemetry opt-out ───────────────────────────────────────────────

/**
 * Check if the user has opted out of telemetry.
 *
 * Industry standard: respect DO_NOT_TRACK (cross-tool convention)
 * and our own AMPLITUDE_WIZARD_NO_TELEMETRY.
 * Also disabled in test environments.
 */
function isTelemetryDisabled(): boolean {
  if (process.env.NODE_ENV === 'test') return true;
  if (process.env.DO_NOT_TRACK === '1') return true;
  if (process.env.AMPLITUDE_WIZARD_NO_TELEMETRY === '1') return true;
  return false;
}

// ── Environment resolution ──────────────────────────────────────────

function resolveEnvironment(mode: ExecutionMode): string {
  if (process.env.NODE_ENV === 'test') return 'test';
  if (mode === 'ci') return 'ci';
  if (mode === 'agent') return 'agent';
  const isDev = ['development'].includes(process.env.NODE_ENV ?? '');
  if (isDev) return 'development';
  return 'production';
}

// ── beforeSend: redaction + fingerprinting ──────────────────────────

function beforeSend(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  // Selectively redact user-facing fields only. Do NOT redact the entire event
  // — Sentry's own fields (event_id, trace_id, span_id) are 32+ hex chars
  // that the hex pattern would corrupt.
  if (event.exception?.values) {
    event.exception.values = event.exception.values.map((v) => ({
      ...v,
      value: v.value ? redactString(v.value) : v.value,
    }));
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((b) => ({
      ...b,
      message: b.message ? redactString(b.message) : b.message,
      data: b.data ? (redact(b.data) as Record<string, unknown>) : b.data,
    }));
  }
  if (event.contexts) {
    // Redact custom wizard contexts but preserve Sentry system contexts (trace, etc.)
    const SYSTEM_CONTEXTS = new Set([
      'trace',
      'otel',
      'runtime',
      'os',
      'device',
      'app',
      'browser',
    ]);
    for (const [key, ctx] of Object.entries(event.contexts)) {
      if (!SYSTEM_CONTEXTS.has(key) && ctx) {
        event.contexts[key] = redact(ctx) as Record<string, unknown>;
      }
    }
  }

  // Custom fingerprinting: group by error classification, not raw message.
  if (event.exception?.values?.[0]) {
    const error = new Error(event.exception.values[0].value ?? 'unknown');
    error.name = event.exception.values[0].type ?? 'Error';
    const classified = getClassifyError()(error);

    const category = classified.retryable ? 'transient' : 'permanent';
    const integration = event.tags?.integration as string | undefined;

    event.fingerprint = [
      '{{ default }}',
      category,
      ...(integration ? [integration] : []),
    ];

    event.contexts = {
      ...event.contexts,
      classification: {
        message: classified.message,
        suggestion: classified.suggestion,
        retryable: classified.retryable,
        ...(classified.docsUrl ? { docs_url: classified.docsUrl } : {}),
      },
    };
  }

  return event;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Initialize Sentry for the wizard CLI.
 * Must be called early in startup (bin.ts), after correlation is initialized.
 */
export function initSentry(config: SentryConfig): void {
  if (isTelemetryDisabled()) {
    initialized = false;
    // Still register the sink so the logger doesn't error, but it will no-op
    registerSentrySink();
    return;
  }

  try {
    Sentry.init({
      dsn: process.env.SENTRY_DSN ?? WIZARD_SENTRY_DSN,
      release: `@amplitude/wizard@${config.version}`,
      environment: resolveEnvironment(config.mode),

      // CLI-specific settings
      tracesSampleRate: 1.0, // Low volume CLI — every run matters
      sendDefaultPii: true,

      // Structured logs — feeds Sentry.logger.* calls and the logger sink
      enableLogs: true,

      // Error filtering and redaction
      beforeSend,

      // Debug mode logs Sentry internals to console
      debug: config.debug && process.env.SENTRY_DEBUG === '1',

      profilesSampleRate: 1.0,
    });

    // Set initial context
    Sentry.setTag('mode', config.mode);
    Sentry.setTag('wizard_version', config.version);
    Sentry.setTag('platform', process.platform);
    Sentry.setTag('node_version', process.version);
    Sentry.setTag('session_id', config.sessionId);

    initialized = true;
  } catch {
    // Sentry init failure is non-fatal — wizard continues without error tracking
    initialized = false;
  }

  registerSentrySink();
}

/**
 * Register the logger sink so:
 *   - log.error() → Sentry.captureException (issue-grouped, fingerprinted)
 *   - log.warn() / log.info() → Sentry.logger.* (searchable structured logs)
 *                             + Sentry.addBreadcrumb (attached to any later error)
 *
 * Breadcrumbs stay because they give pre-error context on the issue view;
 * Sentry.logger gives full-text log search decoupled from error events.
 */
function registerSentrySink(): void {
  setSentrySink(
    (
      level: LogLevel,
      namespace: string,
      msg: string,
      ctx?: Record<string, unknown>,
    ) => {
      if (!initialized) return;
      if (level === 'error') {
        captureError(new Error(msg), { namespace, ...ctx });
        return;
      }
      const attrs: Record<string, unknown> = {
        namespace,
        ...(ctx ? (redact(ctx) as Record<string, unknown>) : {}),
      };
      try {
        const redactedMsg = redactString(msg);
        if (level === 'warn') Sentry.logger.warn(redactedMsg, attrs);
        else if (level === 'info') Sentry.logger.info(redactedMsg, attrs);
        else Sentry.logger.debug(redactedMsg, attrs);
      } catch {
        // Non-fatal
      }
      addBreadcrumb(namespace, msg, ctx);
    },
  );
}

/**
 * Capture an error to Sentry with optional context.
 */
export function captureError(
  error: Error,
  context?: Record<string, unknown>,
): void {
  if (!initialized) return;
  try {
    Sentry.captureException(error, {
      contexts: {
        wizard: context ? (redact(context) as Record<string, unknown>) : {},
      },
    });
  } catch {
    // Sentry capture failure is non-fatal
  }
}

/**
 * Add a breadcrumb to Sentry for debugging context.
 */
export function addBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  if (!initialized) return;
  try {
    Sentry.addBreadcrumb({
      category,
      message,
      data: data ? (redact(data) as Record<string, unknown>) : undefined,
      level: 'info',
    });
  } catch {
    // Non-fatal
  }
}

/**
 * Set the Sentry user context (called when analytics.setDistinctId fires).
 */
export function setSentryUser(userId: string): void {
  if (!initialized) return;
  try {
    Sentry.setUser({ id: userId });
  } catch {
    // Non-fatal
  }
}

/**
 * Set a tag on the current Sentry scope.
 */
export function setSentryTag(key: string, value: string): void {
  if (!initialized) return;
  try {
    Sentry.setTag(key, value);
  } catch {
    // Non-fatal
  }
}

/**
 * Start a Sentry performance span that you manually `.end()`.
 *
 * Returns an object with `end()` and `setAttribute()` methods. When Sentry
 * is not initialized (telemetry disabled, init failed, etc.), returns a
 * no-op that's safe to call.
 *
 * Use this for cross-callback lifecycles (e.g., agent run from onInit to
 * onFinalize) where `Sentry.startSpan(cb)` doesn't fit.
 */
export interface WizardSpan {
  end(): void;
  setAttribute(key: string, value: unknown): void;
}

type SpanAttrValue = string | number | boolean;

function coerceAttr(value: unknown): SpanAttrValue {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (value === null || value === undefined) return '';
  return JSON.stringify(value);
}

function toSpanAttributes(
  input: Record<string, unknown>,
): Record<string, SpanAttrValue> {
  const out: Record<string, SpanAttrValue> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    out[k] = coerceAttr(v);
  }
  return out;
}

export function startWizardSpan(
  name: string,
  op: string,
  attributes?: Record<string, unknown>,
): WizardSpan {
  if (!initialized) {
    return { end: () => {}, setAttribute: () => {} };
  }
  try {
    const span = Sentry.startInactiveSpan({
      name,
      op,
      attributes: attributes
        ? toSpanAttributes(redact(attributes) as Record<string, unknown>)
        : undefined,
    });
    return {
      end: () => {
        try {
          span.end();
        } catch {
          /* non-fatal */
        }
      },
      setAttribute: (key, value) => {
        try {
          span.setAttribute(key, coerceAttr(value));
        } catch {
          /* non-fatal */
        }
      },
    };
  } catch {
    return { end: () => {}, setAttribute: () => {} };
  }
}

/**
 * Flush pending Sentry events before exit (2s timeout).
 */
export async function flushSentry(): Promise<void> {
  if (!initialized) return;
  try {
    await Sentry.flush(2000);
  } catch {
    // Flush failure is non-fatal — don't block exit
  }
}
