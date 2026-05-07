/**
 * Project-size detection used to gate the pre-flight context block.
 *
 * Background: PR #600 added `buildPreflightContext` which always injected a
 * structured Markdown summary of every value the wizard had already
 * discovered (framework, package manager, env keys, org/project, etc.).
 * Internal LLM-reliability research flagged that this regresses on
 * attention budget for medium-and-up codebases — Anthropic's guidance is
 * to prefer just-in-time (JIT) context loading via `read_file` / `grep`
 * for projects above ~50 events or ~200 source files. This helper scans
 * the install directory under a hard 5s wall-clock cap and reports the
 * counts the gate uses.
 *
 * Pure-ish: `fs.readdirSync` recursively, plus a single read of
 * `events.json`. No network, no spawning.
 *
 * Bias: when detection times out, returns `timedOut: true`. The caller
 * is expected to treat that as "large project" — large codebases
 * shouldn't be paying a probe tax to figure out they're large.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseEventPlanContent } from '../event-plan-parser.js';
import { getEventsFile } from '../../utils/storage-paths.js';

/** Default file-count threshold above which we switch to JIT mode. */
export const DEFAULT_FILE_THRESHOLD = 200;

/** Default event-count threshold above which we switch to JIT mode. */
export const DEFAULT_EVENT_THRESHOLD = 50;

/** Default wall-clock cap on the recursive directory scan. */
export const DEFAULT_DETECTION_TIMEOUT_MS = 5_000;

/** Env-var override names. Documented in `CLAUDE.md`. */
export const FILE_THRESHOLD_ENV = 'AMPLITUDE_WIZARD_PREFLIGHT_FILE_THRESHOLD';
export const EVENT_THRESHOLD_ENV = 'AMPLITUDE_WIZARD_PREFLIGHT_EVENT_THRESHOLD';

/**
 * Directory basenames we never descend into during the source-file count.
 * Includes dependency installs, version-control metadata, common build
 * outputs, and IDE/test caches. We err on the side of skipping — the
 * threshold is approximate, and counting `node_modules` would dominate
 * every reading and falsely flag every project as "large."
 */
const SKIP_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.amplitude',
  '.next',
  '.nuxt',
  '.expo',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.pnpm-store',
  '.yarn',
  '.gradle',
  '.idea',
  '.vscode',
  'dist',
  'build',
  'out',
  'coverage',
  'target', // rust / java
  'bin',
  'obj',
  '.venv',
  'venv',
  'env',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.tox',
  'vendor', // go / php
  'Pods', // ios
  '.dart_tool',
  '.flutter-plugins-dependencies',
]);

export interface ProjectSizeReport {
  /** Best-effort count of source files under `installDir`. */
  fileCount: number;
  /** Number of confirmed events in `<installDir>/.amplitude/events.json`. 0 when missing. */
  eventCount: number;
  /** True when the directory scan hit the wall-clock cap. */
  timedOut: boolean;
}

export interface DetectProjectSizeOptions {
  /** Hard wall-clock cap. Defaults to `DEFAULT_DETECTION_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/**
 * Walk `installDir` recursively counting files (excluding the directories
 * in `SKIP_DIRECTORIES`). Stops as soon as `Date.now() - start` exceeds
 * `timeoutMs` and reports `timedOut: true`. Always returns synchronously
 * — `fs.readdirSync` with `withFileTypes: true` is the cheapest API for
 * a depth-first walk on Node 20+.
 */
function countSourceFiles(
  installDir: string,
  timeoutMs: number,
): { fileCount: number; timedOut: boolean } {
  const start = Date.now();
  let fileCount = 0;
  const stack: string[] = [installDir];

  while (stack.length > 0) {
    if (Date.now() - start > timeoutMs) {
      return { fileCount, timedOut: true };
    }
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      // Permission denied / vanished directory — skip silently. Detection
      // is best-effort; a partial count is still useful.
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        // Skip dotted directories at any level (`.cache-foo`, `.next`,
        // bespoke `.something`) unless explicitly allowlisted via not
        // being in `SKIP_DIRECTORIES`. We already cover the common
        // cases above; this guards against IDE / tool dot-dirs we
        // didn't enumerate.
        if (entry.name.startsWith('.') && !SKIP_DIRECTORIES.has(entry.name)) {
          continue;
        }
        stack.push(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        fileCount += 1;
      }
      // Symlinks, sockets, etc. are intentionally not counted.
    }
  }

  return { fileCount, timedOut: false };
}

/** Read `<installDir>/.amplitude/events.json` and count parsed events. */
function countConfirmedEvents(installDir: string): number {
  const eventsPath = getEventsFile(installDir);
  let content: string;
  try {
    if (!fs.existsSync(eventsPath)) return 0;
    content = fs.readFileSync(eventsPath, 'utf8');
  } catch {
    return 0;
  }
  const parsed = parseEventPlanContent(content);
  if (!parsed) return 0;
  return parsed.filter((e) => e.name.trim().length > 0).length;
}

/**
 * Inspect the project on disk and report the signals the pre-flight gate
 * needs. Synchronous + best-effort; never throws.
 */
export function detectProjectSize(
  installDir: string,
  options: DetectProjectSizeOptions = {},
): ProjectSizeReport {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DETECTION_TIMEOUT_MS;
  const { fileCount, timedOut } = countSourceFiles(installDir, timeoutMs);
  const eventCount = countConfirmedEvents(installDir);
  return { fileCount, eventCount, timedOut };
}

/**
 * Resolve the active threshold pair — env-var overrides take precedence,
 * fall back to the documented defaults. Invalid (non-positive integer)
 * env values are ignored so a typo can't suppress the gate entirely.
 */
export function resolveThresholds(env: NodeJS.ProcessEnv = process.env): {
  fileThreshold: number;
  eventThreshold: number;
} {
  return {
    fileThreshold:
      parsePositiveInt(env[FILE_THRESHOLD_ENV]) ?? DEFAULT_FILE_THRESHOLD,
    eventThreshold:
      parsePositiveInt(env[EVENT_THRESHOLD_ENV]) ?? DEFAULT_EVENT_THRESHOLD,
  };
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Decide whether to use the just-in-time block based on the report and
 * the active thresholds. A `timedOut: true` report always lands on JIT
 * — large projects shouldn't be paying a probe tax to figure out they're
 * large.
 */
export function shouldUseJitMode(
  report: ProjectSizeReport,
  thresholds: { fileThreshold: number; eventThreshold: number },
): boolean {
  if (report.timedOut) return true;
  if (report.fileCount > thresholds.fileThreshold) return true;
  if (report.eventCount > thresholds.eventThreshold) return true;
  return false;
}
