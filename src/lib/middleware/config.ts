/**
 * Benchmark configuration loader.
 *
 * Loads .benchmark-config.json from the working directory with sensible defaults.
 * All fields are optional — missing fields fall back to defaults.
 */

import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { logToFile } from '../../utils/debug';
import { AgentSignals } from '../agent-interface';
import {
  getBenchmarkFile,
  getCacheRoot,
  getLogFile,
} from '../../utils/storage-paths';

export interface BenchmarkConfig {
  /** Enable/disable individual metric plugins */
  plugins: Record<string, boolean>;
  output: {
    /** Path for the benchmark JSON output file */
    benchmarkPath: string;
    /** Whether to write the benchmark JSON file */
    benchmarkEnabled: boolean;
    /** Path for the main wizard debug log file */
    logPath: string;
    /** Whether to write the main wizard debug log */
    logEnabled: boolean;
    /** Suppress benchmark console output (disables the summary plugin) */
    suppressWizardLogs: boolean;
  };
}

/** Plugin + flag defaults that don't depend on `installDir`. */
const DEFAULT_PLUGINS: Record<string, boolean> = {
  tokens: true,
  cache: true,
  turns: true,
  compactions: true,
  contextSize: true,
  cost: true,
  duration: true,
  summary: true,
  jsonWriter: true,
};

const DEFAULT_FLAGS = {
  benchmarkEnabled: true,
  logEnabled: true,
  suppressWizardLogs: false,
};

/**
 * Build the default benchmark config. When `installDir` is provided, the
 * benchmark and log paths are scoped to that project's run dir under the
 * cache root. Without `installDir`, paths fall back to a `_bootstrap` run
 * dir — this only matters for the rare callers (and tests) that need a
 * config object before installDir resolution.
 */
function buildDefaultConfig(installDir?: string): BenchmarkConfig {
  const benchmarkPath = installDir
    ? getBenchmarkFile(installDir)
    : path.join(getCacheRoot(), 'runs', '_bootstrap', 'benchmark.json');
  const logPath = installDir
    ? getLogFile(installDir)
    : path.join(getCacheRoot(), 'bootstrap.log');
  return {
    plugins: { ...DEFAULT_PLUGINS },
    output: {
      benchmarkPath,
      benchmarkEnabled: DEFAULT_FLAGS.benchmarkEnabled,
      logPath,
      logEnabled: DEFAULT_FLAGS.logEnabled,
      suppressWizardLogs: DEFAULT_FLAGS.suppressWizardLogs,
    },
  };
}

const BenchmarkConfigFileSchema = z
  .object({
    plugins: z.record(z.string(), z.boolean()).optional(),
    output: z
      .object({
        benchmarkPath: z.string(),
        benchmarkEnabled: z.boolean(),
        logPath: z.string(),
        logEnabled: z.boolean(),
        suppressWizardLogs: z.boolean(),
      })
      .partial()
      .optional(),
  })
  .passthrough();

export function loadBenchmarkConfig(installDir: string): BenchmarkConfig {
  const defaults = buildDefaultConfig(installDir);
  const configPath =
    process.env.AMPLITUDE_WIZARD_BENCHMARK_CONFIG ??
    path.join(installDir, '.benchmark-config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const result = BenchmarkConfigFileSchema.safeParse(JSON.parse(raw));
    if (!result.success) throw result.error;
    const parsed = result.data;
    const config: BenchmarkConfig = {
      plugins: { ...defaults.plugins, ...parsed.plugins },
      output: { ...defaults.output, ...parsed.output },
    };

    // Env var overrides for parallel runs
    if (process.env.AMPLITUDE_WIZARD_BENCHMARK_FILE) {
      config.output.benchmarkPath = process.env.AMPLITUDE_WIZARD_BENCHMARK_FILE;
    }
    if (process.env.AMPLITUDE_WIZARD_LOG_FILE) {
      config.output.logPath = process.env.AMPLITUDE_WIZARD_LOG_FILE;
    }

    // If benchmark output is disabled, disable the jsonWriter plugin
    if (!config.output.benchmarkEnabled) {
      config.plugins.jsonWriter = false;
    }

    logToFile(`${AgentSignals.BENCHMARK} Loaded config from ${configPath}`);
    return config;
  } catch {
    // No config file or invalid JSON — use defaults
    const config = defaults;

    // Env var overrides
    if (process.env.AMPLITUDE_WIZARD_BENCHMARK_FILE) {
      config.output.benchmarkPath = process.env.AMPLITUDE_WIZARD_BENCHMARK_FILE;
    }
    if (process.env.AMPLITUDE_WIZARD_LOG_FILE) {
      config.output.logPath = process.env.AMPLITUDE_WIZARD_LOG_FILE;
    }

    return config;
  }
}

/**
 * Returns the default benchmark config with bootstrap paths. Tests and
 * callers without an `installDir` rely on this; in-flight wizard runs
 * should use {@link loadBenchmarkConfig} so paths land under the project's
 * run dir.
 */
export function getDefaultConfig(): BenchmarkConfig {
  return buildDefaultConfig();
}
