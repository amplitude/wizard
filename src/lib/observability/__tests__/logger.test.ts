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

  it('writes structured JSON to the log file', () => {
    const log = createLogger('test-module');
    log.info('hello world', { key: 'value' });

    const content = readFileSync(logFile, 'utf-8');
    const lines = content.split('\n').filter((l) => l.startsWith('{'));
    expect(lines.length).toBe(1);

    const entry = JSON.parse(lines[0]);
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

    const content = readFileSync(logFile, 'utf-8');
    const lines = content.split('\n').filter((l) => l.startsWith('{'));
    expect(lines.length).toBe(4);

    const levels = lines.map((l) => JSON.parse(l).level);
    expect(levels).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('child loggers inherit namespace', () => {
    const log = createLogger('parent');
    const child = log.child('child');
    child.info('from child');

    const content = readFileSync(logFile, 'utf-8');
    const lines = content.split('\n').filter((l) => l.startsWith('{'));
    const entry = JSON.parse(lines[0]);
    expect(entry.namespace).toBe('parent:child');
  });

  it('redacts sensitive data in log file entries', () => {
    const log = createLogger('redaction');
    log.info('auth complete', {
      accessToken: 'secret-token-123',
      host: 'https://api.amplitude.com',
    });

    const content = readFileSync(logFile, 'utf-8');
    const lines = content.split('\n').filter((l) => l.startsWith('{'));
    const entry = JSON.parse(lines[0]);
    expect(entry.ctx.accessToken).toBe('[REDACTED]');
    expect(entry.ctx.host).toBe('https://api.amplitude.com');
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
    // Reinitialize with debug mode
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

  it('omits ctx from log entry when empty', () => {
    const log = createLogger('no-ctx');
    log.info('no context');

    const content = readFileSync(logFile, 'utf-8');
    const lines = content.split('\n').filter((l) => l.startsWith('{'));
    const entry = JSON.parse(lines[0]);
    expect(entry.ctx).toBeUndefined();
  });

  it('never throws even if file write fails', () => {
    configureLogFile({ path: '/nonexistent/path/log.txt', enabled: true });
    const log = createLogger('safe');
    // Should not throw
    expect(() => log.error('this should not crash')).not.toThrow();
  });
});
