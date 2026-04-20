/**
 * Debug and file logging utilities.
 *
 * This module now delegates to the structured logger in `src/lib/observability/`.
 * The public API (`debug()`, `logToFile()`, `enableDebugLogs()`) is preserved
 * for backward compatibility — existing call sites don't need to change.
 *
 * New code should use `createLogger()` from `../lib/observability` directly.
 */

import chalk from 'chalk';
import { prepareMessage } from './logging';
import { getUI } from '../ui';
import {
  createLogger,
  configureLogFile as configureObservabilityLogFile,
  getLogFilePath as getObservabilityLogFilePath,
} from '../lib/observability';

const legacyLog = createLogger('legacy');

let debugEnabled = false;

export function getLogFilePath(): string {
  return getObservabilityLogFilePath();
}

/**
 * Configure the log file path and enable/disable state.
 * Call before initLogFile() to override defaults.
 */
export function configureLogFile(opts: {
  path?: string;
  enabled?: boolean;
}): void {
  configureObservabilityLogFile(opts);
}

/**
 * Initialize the log file with a run header.
 * @deprecated The structured logger handles initialization via `initLogger()`.
 * Kept for backward compatibility — safe to call but may be a no-op
 * if `initLogger()` has already been called.
 */
export function initLogFile() {
  // initLogger() in bin.ts now handles file init.
  // This is kept as a no-op for any remaining call sites.
}

/**
 * Log a message to the log file.
 * Always writes regardless of debug flag (when logging is enabled).
 * Fails silently to avoid masking errors in catch blocks.
 *
 * @deprecated Use `createLogger('my-module').debug()` or `.info()` instead.
 */
export function logToFile(...args: unknown[]) {
  const msg = args.map((a) => prepareMessage(a)).join(' ');
  // Route through the structured logger at debug level.
  // The logger writes to the file with structured JSON.
  legacyLog.debug(msg);
}

export function debug(...args: unknown[]) {
  if (!debugEnabled) {
    return;
  }

  const msg = args.map((a) => prepareMessage(a)).join(' ');

  getUI().log.info(chalk.dim(msg));
}

export function enableDebugLogs() {
  debugEnabled = true;
}
