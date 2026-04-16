/**
 * Structured logger for the Amplitude Wizard CLI.
 *
 * Design principles:
 * - Dead-simple API for contributors: `const log = createLogger('my-module')`
 * - Mode-aware: TUI routes through UI abstraction, Agent emits NDJSON, CI uses LoggingUI
 * - Always writes to log file regardless of terminal verbosity
 * - Never calls console.log directly (Ink owns stdout in TUI mode)
 * - Structured context in second arg (appears in log file, not terminal)
 * - Automatic redaction at serialization boundary
 */

import { appendFileSync, statSync, renameSync } from 'fs';
import type { ExecutionMode } from '../mode-config';
import { redact, redactString } from './redact';
import { getRunId, getSessionId } from './correlation';

// ── Types ───────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface WizardLogger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  /** Create a child logger with a sub-namespace. */
  child(sub: string): WizardLogger;
}

interface LoggerConfig {
  mode: ExecutionMode;
  /** Show debug-level on terminal */
  debug: boolean;
  /** Show info-level on terminal */
  verbose: boolean;
  /** Wizard version for log headers */
  version: string;
}

interface LogEntry {
  '@timestamp': string;
  run_id: string;
  session_id: string;
  namespace: string;
  level: LogLevel;
  msg: string;
  ctx?: Record<string, unknown>;
}

// ── State ───────────────────────────────────────────────────────────

let config: LoggerConfig | null = null;
let logFilePath = '/tmp/amplitude-wizard.log';
let logFileEnabled = process.env.NODE_ENV !== 'test';

const LOG_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/** Callbacks registered by the UI layer for terminal output. */
let terminalSink:
  | ((level: LogLevel, namespace: string, msg: string) => void)
  | null = null;

/** Callbacks registered for Sentry integration (Phase 2). */
let sentrySink:
  | ((
      level: LogLevel,
      namespace: string,
      msg: string,
      ctx?: Record<string, unknown>,
      error?: Error,
    ) => void)
  | null = null;

// ── Level ordering ──────────────────────────────────────────────────

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Minimum level to show on terminal based on config flags. */
function terminalMinLevel(): number {
  if (!config) return LEVEL_ORDER.warn;
  if (config.debug) return LEVEL_ORDER.debug;
  if (config.verbose) return LEVEL_ORDER.info;
  return LEVEL_ORDER.warn;
}

// ── Initialization ──────────────────────────────────────────────────

/**
 * Initialize the logger. Call once at startup after mode resolution.
 */
export function initLogger(
  opts: LoggerConfig & {
    logFile?: string;
    logFileEnabled?: boolean;
  },
): void {
  config = opts;
  if (opts.logFile !== undefined) logFilePath = opts.logFile;
  if (opts.logFileEnabled !== undefined) logFileEnabled = opts.logFileEnabled;

  if (!logFileEnabled) return;

  // Rotate if over limit (keep one backup)
  try {
    const stats = statSync(logFilePath);
    if (stats.size > LOG_MAX_BYTES) {
      try {
        renameSync(logFilePath, `${logFilePath}.1`);
      } catch {
        // Rename failed — truncate will happen naturally
      }
    }
  } catch {
    // File doesn't exist yet — fine
  }

  // Write run header
  const header = [
    '',
    '='.repeat(60),
    `Amplitude Wizard Run: ${new Date().toISOString()}`,
    `  version: ${opts.version}`,
    `  mode: ${opts.mode}`,
    `  node: ${process.version}`,
    `  platform: ${process.platform}`,
    `  run_id: ${getRunId()}`,
    `  session_id: ${getSessionId()}`,
    '='.repeat(60),
    '',
  ].join('\n');

  try {
    appendFileSync(logFilePath, header);
  } catch {
    // Non-critical — don't crash
  }
}

/**
 * Register a terminal output sink. Called by the UI layer during setup.
 * The sink receives (level, namespace, message) and decides how to render.
 */
export function setTerminalSink(
  sink: (level: LogLevel, namespace: string, msg: string) => void,
): void {
  terminalSink = sink;
}

/**
 * Register a Sentry sink. Called by the Sentry module during Phase 2 init.
 */
export function setSentrySink(
  sink: (
    level: LogLevel,
    namespace: string,
    msg: string,
    ctx?: Record<string, unknown>,
    error?: Error,
  ) => void,
): void {
  sentrySink = sink;
}

/** Get the current log file path. */
export function getLogFilePath(): string {
  return logFilePath;
}

/** Override log file path and enabled state (for tests / config). */
export function configureLogFile(opts: {
  path?: string;
  enabled?: boolean;
}): void {
  if (opts.path !== undefined) logFilePath = opts.path;
  if (opts.enabled !== undefined) logFileEnabled = opts.enabled;
}

// ── File writer ─────────────────────────────────────────────────────

function writeToFile(entry: LogEntry): void {
  if (!logFileEnabled) return;
  try {
    // Redact the entire entry before writing
    const redacted = redact(entry) as LogEntry;
    appendFileSync(logFilePath, JSON.stringify(redacted) + '\n');
  } catch {
    // Silently ignore — logging must never crash the wizard
  }
}

// ── Logger factory ──────────────────────────────────────────────────

function makeLogger(namespace: string): WizardLogger {
  const log = (
    level: LogLevel,
    msg: string,
    ctx?: Record<string, unknown>,
  ): void => {
    const entry: LogEntry = {
      '@timestamp': new Date().toISOString(),
      run_id: getRunId(),
      session_id: getSessionId(),
      namespace,
      level,
      msg,
      ...(ctx && Object.keys(ctx).length > 0 ? { ctx } : {}),
    };

    // 1. Always write to file
    writeToFile(entry);

    // 2. Terminal output (level-gated)
    if (terminalSink && LEVEL_ORDER[level] >= terminalMinLevel()) {
      terminalSink(level, namespace, redactString(msg));
    }

    // 3. Sentry sink (Phase 2 — no-op until registered)
    if (sentrySink && LEVEL_ORDER[level] >= LEVEL_ORDER.info) {
      sentrySink(level, namespace, msg, ctx);
    }
  };

  return {
    debug: (msg, ctx?) => log('debug', msg, ctx),
    info: (msg, ctx?) => log('info', msg, ctx),
    warn: (msg, ctx?) => log('warn', msg, ctx),
    error: (msg, ctx?) => log('error', msg, ctx),
    child: (sub) => makeLogger(`${namespace}:${sub}`),
  };
}

/**
 * Create a namespaced logger instance.
 *
 * ```ts
 * import { createLogger } from '../lib/observability';
 * const log = createLogger('agent-runner');
 * log.info('Starting framework detection', { framework: 'nextjs' });
 * ```
 */
export function createLogger(namespace: string): WizardLogger {
  return makeLogger(namespace);
}
