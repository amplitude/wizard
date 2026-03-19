import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Mock getUI to prevent real UI calls in debug() tests
vi.mock('../ui/index.js', () => ({
  getUI: vi.fn(() => ({
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  })),
}));
vi.mock('../../ui/index.js', () => ({
  getUI: vi.fn(() => ({
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  })),
}));

import {
  getLogFilePath,
  configureLogFile,
  initLogFile,
  logToFile,
  enableDebugLogs,
  debug,
} from '../debug.js';

// ── helpers ───────────────────────────────────────────────────────────────────

let tmpDir: string;
const DEFAULT_LOG_PATH = '/tmp/amplitude-wizard.log';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debug-test-'));
  // Reset module state: restore default path, disable logging
  configureLogFile({ path: DEFAULT_LOG_PATH, enabled: false });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  // Ensure logging is off again after each test
  configureLogFile({ path: DEFAULT_LOG_PATH, enabled: false });
});

// ── getLogFilePath ────────────────────────────────────────────────────────────

describe('getLogFilePath', () => {
  it('returns the current log file path', () => {
    expect(getLogFilePath()).toBe(DEFAULT_LOG_PATH);
  });

  it('reflects changes made via configureLogFile', () => {
    configureLogFile({ path: '/my/custom.log' });
    expect(getLogFilePath()).toBe('/my/custom.log');
  });
});

// ── configureLogFile ──────────────────────────────────────────────────────────

describe('configureLogFile', () => {
  it('updates the log file path', () => {
    const newPath = path.join(tmpDir, 'test.log');
    configureLogFile({ path: newPath });
    expect(getLogFilePath()).toBe(newPath);
  });

  it('does not change path when path is omitted', () => {
    const before = getLogFilePath();
    configureLogFile({ enabled: false });
    expect(getLogFilePath()).toBe(before);
  });
});

// ── initLogFile ───────────────────────────────────────────────────────────────

describe('initLogFile', () => {
  it('does not create a file when logging is disabled', () => {
    const logPath = path.join(tmpDir, 'disabled.log');
    configureLogFile({ path: logPath, enabled: false });
    initLogFile();
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it('creates the log file with a run header when enabled', () => {
    const logPath = path.join(tmpDir, 'wizard.log');
    configureLogFile({ path: logPath, enabled: true });
    initLogFile();
    expect(fs.existsSync(logPath)).toBe(true);
    const contents = fs.readFileSync(logPath, 'utf-8');
    expect(contents).toContain('Amplitude Wizard Run:');
  });

  it('truncates the log if it exceeds 5 MB', () => {
    const logPath = path.join(tmpDir, 'big.log');
    // Write 6 MB of data
    fs.writeFileSync(logPath, 'x'.repeat(6 * 1024 * 1024));
    configureLogFile({ path: logPath, enabled: true });
    initLogFile();
    const size = fs.statSync(logPath).size;
    expect(size).toBeLessThan(6 * 1024 * 1024);
  });
});

// ── logToFile ─────────────────────────────────────────────────────────────────

describe('logToFile', () => {
  it('does not write when logging is disabled', () => {
    const logPath = path.join(tmpDir, 'noop.log');
    configureLogFile({ path: logPath, enabled: false });
    logToFile('this should not appear');
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it('appends a timestamped message to the log file when enabled', () => {
    const logPath = path.join(tmpDir, 'output.log');
    configureLogFile({ path: logPath, enabled: true });
    logToFile('hello world');
    const contents = fs.readFileSync(logPath, 'utf-8');
    expect(contents).toContain('hello world');
  });

  it('handles multiple arguments', () => {
    const logPath = path.join(tmpDir, 'multi.log');
    configureLogFile({ path: logPath, enabled: true });
    logToFile('part1', 'part2', { key: 'val' });
    const contents = fs.readFileSync(logPath, 'utf-8');
    expect(contents).toContain('part1');
    expect(contents).toContain('part2');
  });

  it('fails silently when the log file path is invalid', () => {
    configureLogFile({ path: '/nonexistent/dir/file.log', enabled: true });
    expect(() => logToFile('this might fail')).not.toThrow();
  });
});

// ── enableDebugLogs + debug ───────────────────────────────────────────────────

describe('debug', () => {
  it('does not call getUI before enableDebugLogs', async () => {
    const { getUI } = await import('../ui/index.js').catch(
      () => import('../../ui/index.js'),
    );
    vi.mocked(getUI).mockClear();
    debug('silent message');
    // debug() returns early when disabled — getUI should not be called
  });

  it('calls getUI().log.info after enableDebugLogs()', async () => {
    const uiMod = await import('../ui/index.js').catch(
      () => import('../../ui/index.js'),
    );
    const mockInfo = vi.fn();
    vi.mocked(uiMod.getUI).mockReturnValue({
      log: { info: mockInfo, warn: vi.fn(), error: vi.fn() },
    } as ReturnType<typeof uiMod.getUI>);

    enableDebugLogs();
    debug('visible message');

    expect(mockInfo).toHaveBeenCalled();
  });
});
