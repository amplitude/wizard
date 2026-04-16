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
} from './logger';
export type { WizardLogger, LogLevel } from './logger';

// Redaction
export { redact, redactString } from './redact';

// Correlation
export {
  initCorrelation,
  getSessionId,
  getRunId,
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
} from './sentry';
export type { SentryConfig } from './sentry';
