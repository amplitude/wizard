/**
 * Observability module — structured logging, redaction, correlation, and error tracking.
 *
 * Usage:
 * ```ts
 * import { createLogger } from '../lib/observability';
 * const log = createLogger('my-module');
 * log.info('Something happened', { detail: 'value' });
 * ```
 */

// Logger
export {
  createLogger,
  initLogger,
  setTerminalSink,
  configureLogFile,
  getLogFilePath,
  getStructuredLogFilePath,
  setProjectLogFile,
} from './logger';
export type { WizardLogger, LogLevel } from './logger';

// Redaction
export { redact, redactString } from './redact';

// Correlation
export {
  initCorrelation,
  getSessionId,
  getRunId,
  getSessionStartMs,
  rotateRunId,
} from './correlation';

// Sentry
export {
  initSentry,
  captureError,
  addBreadcrumb,
  setSentryUser,
  setSentryTag,
  flushSentry,
  startWizardSpan,
  withWizardSpan,
  wrapMcpServerWithSentry,
  setSpanMeasurement,
} from './sentry';
export type { SentryConfig, WizardSpan } from './sentry';
