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
import { dirname, join } from 'path';
import type { ExecutionMode } from '../mode-config';
import { redact, redactString } from './redact';
import { getRunId, getSessionId } from './correlation';
import {
  ensureDir,
  getCacheRoot,
  getLogFile as getProjectLogFile,
} from '../../utils/storage-paths';

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
/**
 * Active log file path. Lazy-initialized from {@link bootstrapLogPath} so
 * the first write before `initLogger` lands in the cache root, not in
 * `/tmp`. Once `bin.ts` resolves `installDir`, it should call
 * {@link setProjectLogFile} to switch to the per-project log.
 */
let logFilePath: string | null = null;
let logFileEnabled = process.env.NODE_ENV !== 'test';

/**
 * Pre-installDir bootstrap log location. Used only for entries written
 * before the wizard knows which project it's running in (early arg parsing,
 * auth state). Switching to the per-project log via
 * {@link setProjectLogFile} happens as soon as installDir is resolved.
 */
function bootstrapLogPath(): string {
  return join(getCacheRoot(), 'bootstrap.log');
}

function activeLogPath(): string {
  return logFilePath ?? bootstrapLogPath();
}

function activeStructuredLogPath(): string {
  return activeLogPath() + 'l';
}

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

  const activePath = activeLogPath();
  // Make sure the cache root (or per-project run dir) exists before any
  // append. mkdir failures are silent; the appendFileSync below will
  // surface a more useful error if the directory really can't be created.
  ensureDir(dirname(activePath));

  // Rotate if over limit (keep one backup). Rotate both .log and .logl files.
  for (const path of [activePath, activePath + 'l']) {
    try {
      const stats = statSync(path);
      if (stats.size > LOG_MAX_BYTES) {
        try {
          renameSync(path, `${path}.1`);
        } catch {
          // Rename failed — truncate will happen naturally
        }
      }
    } catch {
      // File doesn't exist yet — fine
    }
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
    appendFileSync(activePath, header);
  } catch {
    // Non-critical — don't crash
  }
}

/**
 * Switch the log file to the per-project location once `installDir` is known.
 * Writes a marker line so the bootstrap → project transition is visible in
 * both files. Idempotent.
 */
export function setProjectLogFile(installDir: string): void {
  if (!installDir) return;
  const target = getProjectLogFile(installDir);
  if (logFilePath === target) return;
  ensureDir(dirname(target));
  // Leave a breadcrumb in the bootstrap log so debuggers can find the
  // per-project log they should be reading instead.
  if (logFileEnabled) {
    try {
      const marker = `[${new Date().toISOString()}] [logger] continuing in ${target}\n`;
      appendFileSync(activeLogPath(), marker);
    } catch {
      // Non-critical
    }
  }
  logFilePath = target;
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

/** Get the current (active) log file path. */
export function getLogFilePath(): string {
  return activeLogPath();
}

/** Get the current structured (NDJSON) log file path. Suffix `l`. */
export function getStructuredLogFilePath(): string {
  return activeStructuredLogPath();
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

const LEVEL_LABEL: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
};

function writeToFile(entry: LogEntry): void {
  if (!logFileEnabled) return;
  try {
    const redacted = redact(entry) as LogEntry;
    const activePath = activeLogPath();
    ensureDir(dirname(activePath));

    // 1. Human-readable line to the main log file (displayed in TUI Logs tab).
    const ctxStr =
      redacted.ctx && Object.keys(redacted.ctx).length > 0
        ? ' ' + JSON.stringify(redacted.ctx)
        : '';
    const line = `[${redacted['@timestamp']}] [${redacted.run_id}] [${
      redacted.namespace
    }] ${LEVEL_LABEL[redacted.level]} ${redacted.msg}${ctxStr}\n`;
    appendFileSync(activePath, line);

    // 2. Complete NDJSON to a companion .jsonl file (for programmatic analysis).
    appendFileSync(activePath + 'l', JSON.stringify(redacted) + '\n');
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
