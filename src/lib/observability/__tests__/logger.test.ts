import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createLogger,
  initLogger,
  setTerminalSink,
  configureLogFile,
} from '../logger';
import { initCorrelation } from '../correlation';

describe('logger', () => {
  let tempDir: string;
  let logFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wizard-logger-test-'));
    logFile = join(tempDir, 'test.log');
    initCorrelation('test-session-id');
    configureLogFile({ path: logFile, enabled: true });
    initLogger({
      mode: 'ci',
      debug: false,
      verbose: false,
      version: '1.0.0-test',
      logFile,
      logFileEnabled: true,
    });
  });

  afterEach(() => {
    setTerminalSink(null as never);
    try {
      rmSync(tempDir, { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  /** Get non-empty, non-header log lines (skip the run header block). */
  function getLogLines(): string[] {
    const content = readFileSync(logFile, 'utf-8');
    return content
      .split('\n')
      .filter((l) => l.startsWith('[') && !l.startsWith('[='));
  }

  it('writes human-readable lines to the log file', () => {
    const log = createLogger('test-module');
    log.info('hello world', { key: 'value' });

    const lines = getLogLines();
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('[test-module]');
    expect(lines[0]).toContain('INFO');
    expect(lines[0]).toContain('hello world');
    expect(lines[0]).toContain('"key":"value"');
  });

  it('writes complete NDJSON to the companion .jsonl file', () => {
    const log = createLogger('test-module');
    log.info('hello world', { key: 'value' });

    const jsonlContent = readFileSync(logFile + 'l', 'utf-8');
    const jsonLines = jsonlContent.split('\n').filter((l) => l.startsWith('{'));
    expect(jsonLines.length).toBe(1);

    const entry = JSON.parse(jsonLines[0]);
    expect(entry.namespace).toBe('test-module');
    expect(entry.level).toBe('info');
    expect(entry.msg).toBe('hello world');
    expect(entry.ctx).toEqual({ key: 'value' });
    expect(entry.run_id).toBeDefined();
    expect(entry.session_id).toBe('test-session-id');
  });

  it('writes all levels to the log file', () => {
    const log = createLogger('levels');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');

    const lines = getLogLines();
    expect(lines.length).toBe(4);
    expect(lines[0]).toContain('DEBUG');
    expect(lines[1]).toContain('INFO');
    expect(lines[2]).toContain('WARN');
    expect(lines[3]).toContain('ERROR');
  });

  it('child loggers inherit namespace', () => {
    const log = createLogger('parent');
    const child = log.child('child');
    child.info('from child');

    const lines = getLogLines();
    expect(lines[0]).toContain('[parent:child]');
  });

  it('redacts sensitive data in log file entries', () => {
    const log = createLogger('redaction');
    log.info('auth complete', {
      accessToken: 'secret-token-123',
      host: 'https://api.amplitude.com',
    });

    const lines = getLogLines();
    expect(lines[0]).toContain('[REDACTED]');
    expect(lines[0]).not.toContain('secret-token-123');
    expect(lines[0]).toContain('api.amplitude.com');
  });

  it('routes warn/error to terminal sink by default', () => {
    const messages: Array<{ level: string; msg: string }> = [];
    setTerminalSink((level, _ns, msg) => {
      messages.push({ level, msg });
    });

    const log = createLogger('sink-test');
    log.debug('should not appear');
    log.info('should not appear');
    log.warn('warning!');
    log.error('error!');

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ level: 'warn', msg: 'warning!' });
    expect(messages[1]).toMatchObject({ level: 'error', msg: 'error!' });
  });

  it('routes debug/info to terminal when debug mode is on', () => {
    initLogger({
      mode: 'ci',
      debug: true,
      verbose: true,
      version: '1.0.0-test',
      logFile,
      logFileEnabled: true,
    });

    const messages: Array<{ level: string; msg: string }> = [];
    setTerminalSink((level, _ns, msg) => {
      messages.push({ level, msg });
    });

    const log = createLogger('debug-test');
    log.debug('debug msg');
    log.info('info msg');

    expect(messages).toHaveLength(2);
  });

  it('omits context from log line when empty', () => {
    const log = createLogger('no-ctx');
    log.info('no context');

    const lines = getLogLines();
    // No JSON context appended — line ends with the message
    expect(lines[0]).toMatch(/no context$/);
  });

  it('includes run_id in log lines', () => {
    const log = createLogger('corr');
    log.info('test');

    const lines = getLogLines();
    // run_id is an 8-char hex string in brackets
    expect(lines[0]).toMatch(/\[[a-f0-9]{8}\]/);
  });

  it('never throws even if file write fails', () => {
    configureLogFile({ path: '/nonexistent/path/log.txt', enabled: true });
    const log = createLogger('safe');
    expect(() => log.error('this should not crash')).not.toThrow();
  });
});
