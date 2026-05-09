import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createLogger,
  initLogger,
  setTerminalSink,
  configureLogFile,
  setProjectLogFile,
  getLogFilePath,
  getStructuredLogFilePath,
} from '../logger';
import { initCorrelation } from '../correlation';
import {
  getLogFile,
  getStructuredLogFile,
  CACHE_ROOT_OVERRIDE_ENV,
} from '../../../utils/storage-paths';

describe('logger', () => {
  let tempDir: string;
  let logFile: string;
  let structuredLogFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'wizard-logger-test-'));
    // `.txt` mirrors the per-project layout introduced by storage-paths.ts
    // (`log.txt` + `log.ndjson`). The structured path is auto-derived by
    // `configureLogFile` when omitted, but we set it explicitly so the
    // assertions below can read it back without coupling to the helper.
    logFile = join(tempDir, 'test.log');
    structuredLogFile = join(tempDir, 'test.ndjson');
    initCorrelation('test-session-id');
    configureLogFile({
      path: logFile,
      structuredPath: structuredLogFile,
      enabled: true,
    });
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

  it('writes complete NDJSON to the companion .ndjson file', () => {
    const log = createLogger('test-module');
    log.info('hello world', { key: 'value' });

    const jsonlContent = readFileSync(structuredLogFile, 'utf-8');
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

  // Regression: bugbot caught that `activeStructuredLogPath` previously
  // appended `'l'` to the human path (`log.txt` → `log.txtl`), which
  // diverged from the canonical `log.ndjson` location returned by
  // `getStructuredLogFile` (storage-paths.ts) and referenced by docs +
  // `/diagnostics`. The test pins the human/structured paths to be
  // siblings: same directory, different extensions.
  it('writes the structured log to a `.ndjson` sibling, not `.txtl`', () => {
    const txtPath = join(tempDir, 'a.txt');
    configureLogFile({ path: txtPath, enabled: true });
    const log = createLogger('regression');
    log.info('event');

    const expectedNdjson = join(tempDir, 'a.ndjson');
    expect(readFileSync(expectedNdjson, 'utf-8')).toContain('"msg":"event"');
    // The previous implementation would have written here:
    expect(() => readFileSync(txtPath + 'l', 'utf-8')).toThrow();
  });

  // Regression: bugbot caught that `initLogger`'s size-based rotation
  // renamed `log.txt` → `log.txt.1` but did not close the cached fds.
  // The next `writeToFile()` would keep writing through the stale fd,
  // landing in the rotated backup instead of the fresh target file.
  it('rotates the log on init and writes new lines to the fresh file, not the .1 backup', () => {
    // Pre-fill the human + structured logs past LOG_MAX_BYTES (5 MB).
    const oversized = 'x'.repeat(6 * 1024 * 1024);
    writeFileSync(logFile, oversized);
    writeFileSync(structuredLogFile, oversized);

    // Warm the fd cache by writing one line through the existing logger
    // so the cached fd points at the about-to-be-rotated file. Without
    // this, the test wouldn't actually exercise the cache-invalidation
    // path — it would coincidentally pass because the fd was opened
    // lazily after rotation.
    const warmup = createLogger('warmup');
    warmup.info('warm the fd cache');

    // Re-init: triggers rotation since both files now exceed 5 MB.
    initLogger({
      mode: 'ci',
      debug: false,
      verbose: false,
      version: '1.0.0-test',
      logFile,
      logFileEnabled: true,
    });

    // Sanity check: rotation happened.
    expect(existsSync(logFile + '.1')).toBe(true);
    expect(existsSync(structuredLogFile + '.1')).toBe(true);

    const log = createLogger('post-rotation');
    log.info('after rotation marker');

    // The new line must land in the fresh log, NOT the rotated backup.
    const freshContent = readFileSync(logFile, 'utf-8');
    expect(freshContent).toContain('after rotation marker');

    const rotatedContent = readFileSync(logFile + '.1', 'utf-8');
    expect(rotatedContent).not.toContain('after rotation marker');

    // Same invariant for the structured (NDJSON) sibling.
    const freshStructured = readFileSync(structuredLogFile, 'utf-8');
    expect(freshStructured).toContain('after rotation marker');
    const rotatedStructured = readFileSync(structuredLogFile + '.1', 'utf-8');
    expect(rotatedStructured).not.toContain('after rotation marker');
  });

  // Regression: setProjectLogFile must route the logger to the SAME path
  // that storage-paths.getLogFile(installDir) returns. Otherwise the
  // RunScreen "Logs" tab (which tails getLogFile(session.installDir))
  // shows "Waiting for the agent to start writing logs…" forever while
  // the logger writes to a sibling directory the user can't see — which
  // is exactly the production regression this test guards against.
  it('setProjectLogFile uses the same path as storage-paths.getLogFile', () => {
    const cacheRoot = join(tempDir, 'cache-root');
    const previous = process.env[CACHE_ROOT_OVERRIDE_ENV];
    process.env[CACHE_ROOT_OVERRIDE_ENV] = cacheRoot;
    try {
      const installDir = tempDir; // any real directory; hash is stable
      setProjectLogFile(installDir);

      // Path the LogViewer / /diagnostics consumer reads.
      const expectedHuman = getLogFile(installDir);
      const expectedStructured = getStructuredLogFile(installDir);

      // Path the logger reports as active after the switch.
      expect(getLogFilePath()).toBe(expectedHuman);
      expect(getStructuredLogFilePath()).toBe(expectedStructured);

      // And actually write through — the file must materialize at exactly
      // that path, not a sibling.
      const log = createLogger('path-consistency');
      log.info('routed correctly');
      expect(readFileSync(expectedHuman, 'utf-8')).toContain(
        'routed correctly',
      );
      expect(readFileSync(expectedStructured, 'utf-8')).toContain(
        '"msg":"routed correctly"',
      );
    } finally {
      if (previous === undefined) delete process.env[CACHE_ROOT_OVERRIDE_ENV];
      else process.env[CACHE_ROOT_OVERRIDE_ENV] = previous;
    }
  });

  // Regression: when the per-project run dir is deleted between log
  // writes (e.g. a developer wipes ~/.amplitude/wizard/runs/<hash>/
  // between iterations), the cached fd survives but writes silently
  // disappear. Subsequent log lines must still land in a freshly-
  // recreated file rather than vanishing.
  it('recreates the run dir + reopens the fd when the dir is wiped mid-run', () => {
    const runDir = join(tempDir, 'wipeable');
    const human = join(runDir, 'log.txt');
    const structured = join(runDir, 'log.ndjson');
    configureLogFile({
      path: human,
      structuredPath: structured,
      enabled: true,
    });

    const log = createLogger('wipe-test');
    log.info('before wipe');
    expect(readFileSync(human, 'utf-8')).toContain('before wipe');

    // Simulate the user wiping the runs dir between writes.
    rmSync(runDir, { recursive: true, force: true });
    expect(existsSync(runDir)).toBe(false);

    // The next write must succeed — re-ensure the dir, reopen the fd,
    // retry — not silently no-op.
    log.info('after wipe');

    expect(existsSync(human)).toBe(true);
    expect(readFileSync(human, 'utf-8')).toContain('after wipe');
    expect(readFileSync(structured, 'utf-8')).toContain('"msg":"after wipe"');
  });

  it('configureLogFile auto-derives the structured path when only `path` is passed', () => {
    // Set only the human path; structured should be auto-derived to a
    // `.ndjson` sibling. Verifies the contract that `setProjectLogFile`
    // and `initLogger` rely on (`log.txt` → `log.ndjson`,
    // `bootstrap.log` → `bootstrap.ndjson`).
    configureLogFile({ path: join(tempDir, 'fresh.txt'), enabled: true });
    const log = createLogger('derive');
    log.info('hi');
    expect(readFileSync(join(tempDir, 'fresh.ndjson'), 'utf-8')).toContain(
      '"msg":"hi"',
    );

    // Same for `.log` extension (used by the bootstrap fallback path).
    configureLogFile({ path: join(tempDir, 'fresh.log'), enabled: true });
    const log2 = createLogger('derive-log');
    log2.info('bye');
    expect(readFileSync(join(tempDir, 'fresh.ndjson'), 'utf-8')).toContain(
      '"msg":"bye"',
    );
  });
});
