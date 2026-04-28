import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadBenchmarkConfig, getDefaultConfig } from '../config.js';
import {
  CACHE_ROOT_OVERRIDE_ENV,
  getBenchmarkFile,
  getLogFile,
} from '../../../utils/storage-paths.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function writeConfig(dir: string, data: unknown): void {
  fs.writeFileSync(
    path.join(dir, '.benchmark-config.json'),
    JSON.stringify(data),
    'utf-8',
  );
}

// ── getDefaultConfig ──────────────────────────────────────────────────────────

describe('getDefaultConfig', () => {
  it('returns an object with expected defaults', () => {
    const config = getDefaultConfig();
    expect(config.output.benchmarkEnabled).toBe(true);
    expect(config.output.logEnabled).toBe(true);
    expect(config.output.suppressWizardLogs).toBe(false);
    expect(config.plugins.tokens).toBe(true);
    expect(config.plugins.summary).toBe(true);
  });

  it('returns a new clone each call (no shared reference)', () => {
    const a = getDefaultConfig();
    const b = getDefaultConfig();
    a.output.benchmarkPath = '/mutated';
    expect(b.output.benchmarkPath).not.toBe('/mutated');
  });
});

// ── loadBenchmarkConfig ───────────────────────────────────────────────────────

describe('loadBenchmarkConfig', () => {
  let tmpDir: string;
  let cacheRoot: string;
  let originalCacheOverride: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-config-test-'));
    cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-cache-'));
    originalCacheOverride = process.env[CACHE_ROOT_OVERRIDE_ENV];
    process.env[CACHE_ROOT_OVERRIDE_ENV] = cacheRoot;
    // Clean env overrides before each test
    delete process.env.AMPLITUDE_WIZARD_BENCHMARK_CONFIG;
    delete process.env.AMPLITUDE_WIZARD_BENCHMARK_FILE;
    delete process.env.AMPLITUDE_WIZARD_LOG_FILE;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
    delete process.env.AMPLITUDE_WIZARD_BENCHMARK_CONFIG;
    delete process.env.AMPLITUDE_WIZARD_BENCHMARK_FILE;
    delete process.env.AMPLITUDE_WIZARD_LOG_FILE;
    if (originalCacheOverride === undefined) {
      delete process.env[CACHE_ROOT_OVERRIDE_ENV];
    } else {
      process.env[CACHE_ROOT_OVERRIDE_ENV] = originalCacheOverride;
    }
  });

  // ── fallback to defaults ────────────────────────────────────────────────────

  it('returns defaults when no config file exists', () => {
    const config = loadBenchmarkConfig(tmpDir);
    // Per-project defaults: paths are derived from installDir + cache root.
    expect(config.output.benchmarkPath).toBe(getBenchmarkFile(tmpDir));
    expect(config.output.logPath).toBe(getLogFile(tmpDir));
    expect(config.output.benchmarkEnabled).toBe(true);
    expect(config.output.logEnabled).toBe(true);
  });

  it('returns defaults when config file contains invalid JSON', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.benchmark-config.json'),
      'not json',
      'utf-8',
    );
    const config = loadBenchmarkConfig(tmpDir);
    expect(config.output.benchmarkPath).toBe(getBenchmarkFile(tmpDir));
    expect(config.output.logPath).toBe(getLogFile(tmpDir));
  });

  it('returns defaults when config file fails schema validation', () => {
    writeConfig(tmpDir, { plugins: 'not-an-object' });
    const config = loadBenchmarkConfig(tmpDir);
    // Invalid schema → falls through to catch → per-project defaults
    expect(config.output.benchmarkPath).toBe(getBenchmarkFile(tmpDir));
    expect(config.output.logPath).toBe(getLogFile(tmpDir));
  });

  // ── merging valid config ────────────────────────────────────────────────────

  it('merges plugin overrides with defaults', () => {
    writeConfig(tmpDir, { plugins: { tokens: false, myCustomPlugin: true } });
    const config = loadBenchmarkConfig(tmpDir);
    expect(config.plugins.tokens).toBe(false);
    expect(config.plugins.summary).toBe(true); // unchanged default
    expect(config.plugins.myCustomPlugin).toBe(true); // extra key allowed
  });

  it('merges output overrides with defaults', () => {
    writeConfig(tmpDir, {
      output: { benchmarkPath: '/custom/out.json', logEnabled: false },
    });
    const config = loadBenchmarkConfig(tmpDir);
    expect(config.output.benchmarkPath).toBe('/custom/out.json');
    expect(config.output.logEnabled).toBe(false);
    expect(config.output.benchmarkEnabled).toBe(true); // unchanged default
  });

  // ── benchmarkEnabled: false disables jsonWriter ─────────────────────────────

  it('disables jsonWriter plugin when benchmarkEnabled is false', () => {
    writeConfig(tmpDir, { output: { benchmarkEnabled: false } });
    const config = loadBenchmarkConfig(tmpDir);
    expect(config.plugins.jsonWriter).toBe(false);
  });

  it('keeps jsonWriter enabled when benchmarkEnabled is true', () => {
    writeConfig(tmpDir, { output: { benchmarkEnabled: true } });
    const config = loadBenchmarkConfig(tmpDir);
    expect(config.plugins.jsonWriter).toBe(true);
  });

  // ── env var overrides ───────────────────────────────────────────────────────

  it('uses AMPLITUDE_WIZARD_BENCHMARK_CONFIG to override config file path', () => {
    const customPath = path.join(tmpDir, 'custom-config.json');
    fs.writeFileSync(
      customPath,
      JSON.stringify({ plugins: { tokens: false } }),
      'utf-8',
    );
    process.env.AMPLITUDE_WIZARD_BENCHMARK_CONFIG = customPath;
    const config = loadBenchmarkConfig(tmpDir);
    expect(config.plugins.tokens).toBe(false);
  });

  it('overrides benchmarkPath with AMPLITUDE_WIZARD_BENCHMARK_FILE (file exists)', () => {
    writeConfig(tmpDir, {});
    process.env.AMPLITUDE_WIZARD_BENCHMARK_FILE = '/env/bench.json';
    const config = loadBenchmarkConfig(tmpDir);
    expect(config.output.benchmarkPath).toBe('/env/bench.json');
  });

  it('overrides logPath with AMPLITUDE_WIZARD_LOG_FILE (file exists)', () => {
    writeConfig(tmpDir, {});
    process.env.AMPLITUDE_WIZARD_LOG_FILE = '/env/debug.log';
    const config = loadBenchmarkConfig(tmpDir);
    expect(config.output.logPath).toBe('/env/debug.log');
  });

  it('overrides benchmarkPath with AMPLITUDE_WIZARD_BENCHMARK_FILE (defaults fallback)', () => {
    // No config file — should still apply env override
    process.env.AMPLITUDE_WIZARD_BENCHMARK_FILE = '/env/bench2.json';
    const config = loadBenchmarkConfig(tmpDir);
    expect(config.output.benchmarkPath).toBe('/env/bench2.json');
  });

  it('overrides logPath with AMPLITUDE_WIZARD_LOG_FILE (defaults fallback)', () => {
    process.env.AMPLITUDE_WIZARD_LOG_FILE = '/env/debug2.log';
    const config = loadBenchmarkConfig(tmpDir);
    expect(config.output.logPath).toBe('/env/debug2.log');
  });
});
