import chalk from 'chalk';
import { appendFileSync, statSync, truncateSync } from 'fs';
import { prepareMessage } from './logging';
import { getUI } from '../ui';

let debugEnabled = false;
let logFilePath = '/tmp/amplitude-wizard.log';
// Disable file logging in test environments — tests write via Vitest and
// pollute the shared log with hundreds of synthetic "Wizard failed" entries.
let logEnabled = process.env.NODE_ENV !== 'test';

const LOG_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export function getLogFilePath(): string {
  return logFilePath;
}

/**
 * Configure the log file path and enable/disable state.
 * Call before initLogFile() to override defaults.
 */
export function configureLogFile(opts: {
  path?: string;
  enabled?: boolean;
}): void {
  if (opts.path !== undefined) logFilePath = opts.path;
  if (opts.enabled !== undefined) logEnabled = opts.enabled;
}

/**
 * Initialize the log file with a run header.
 * Call this at the start of each wizard run.
 * Fails silently to avoid crashing the wizard.
 */
export function initLogFile() {
  if (!logEnabled) return;
  try {
    // Truncate the log if it has grown too large, keeping it manageable.
    try {
      if (statSync(logFilePath).size > LOG_MAX_BYTES) {
        truncateSync(logFilePath, 0);
      }
    } catch {
      // File doesn't exist yet — that's fine
    }
    const header = `\n${'='.repeat(
      60,
    )}\nAmplitude Wizard Run: ${new Date().toISOString()}\n${'='.repeat(60)}\n`;
    appendFileSync(logFilePath, header);
  } catch {
    // Silently ignore - logging is non-critical
  }
}

/**
 * Log a message to the log file.
 * Always writes regardless of debug flag (when logging is enabled).
 * Fails silently to avoid masking errors in catch blocks.
 */
export function logToFile(...args: unknown[]) {
  if (!logEnabled) return;
  try {
    const timestamp = new Date().toISOString();
    const msg = args.map((a) => prepareMessage(a)).join(' ');
    appendFileSync(logFilePath, `[${timestamp}] ${msg}\n`);
  } catch {
    // Silently ignore logging failures to avoid masking original errors
  }
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
