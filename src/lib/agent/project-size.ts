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
 * the install directory under a hard 5s wall-clock cap and a 500-file
 * count cap (whichever fires first) and reports the counts the gate uses.
 *
 * Async on purpose: `fs.promises.readdir` lets the event loop service the
 * Ink renderer + the rest of cold-start while we walk the tree. Earlier
 * iterations used `fs.readdirSync` + `withFileTypes`, but on a large
 * monorepo that synchronously blocked the main thread for 1–4s, freezing
 * the spinner and starving any concurrent network calls.
 *
 * Bias: when detection times out (hits the wall-clock cap), returns
 * `timedOut: true`. The caller treats that as "large project" — we don't
 * pay a probe tax to figure out a codebase is large. The file-count cap
 * is reported separately via `capHit` so a user-supplied threshold higher
 * than the cap can still be honored against the partial count.
 */

import { promises as fsp } from 'node:fs';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { parseEventPlanContent } from '../event-plan-parser.js';
import { createLogger } from '../observability/logger.js';
import { getEventsFile } from '../../utils/storage-paths.js';

const log = createLogger('preflight:project-size');

/** Default file-count threshold above which we switch to JIT mode. */
export const DEFAULT_FILE_THRESHOLD = 200;

/** Default event-count threshold above which we switch to JIT mode. */
export const DEFAULT_EVENT_THRESHOLD = 50;

/** Default wall-clock cap on the recursive directory scan. */
const DEFAULT_DETECTION_TIMEOUT_MS = 5_000;

/**
 * Hard cap on files counted before bailing. Once we know the project
 * exceeds this, we already know it's "large" — continuing to walk only
 * burns startup time. Set above `DEFAULT_FILE_THRESHOLD` (200) so the
 * JIT decision still has signal at the default threshold. When callers
 * raise the threshold via env-var, the effective cap is widened
 * proportionally inside `detectProjectSize` so a user-set threshold of
 * 2000 still gets a 2× scan budget instead of being silently capped at
 * 500.
 */
export const DEFAULT_MAX_FILES_SCANNED = 500;

/** Env-var override names. Documented in `CLAUDE.md`. */
const FILE_THRESHOLD_ENV = 'AMPLITUDE_WIZARD_PREFLIGHT_FILE_THRESHOLD';
const EVENT_THRESHOLD_ENV = 'AMPLITUDE_WIZARD_PREFLIGHT_EVENT_THRESHOLD';

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
  // NOTE: bare `env` is intentionally NOT in this set. Many legitimate
  // source trees (e.g. T3-stack Next.js apps) keep TypeScript env-validation
  // schemas under `src/env/` or `app/env/`; skipping them at any depth would
  // undercount real source files and falsely shrink medium projects below
  // the JIT threshold. Python virtualenvs are still skipped via `.venv`.
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
  /**
   * True when the file-count cap (`maxFiles`) fired before the wall-clock
   * cap. Distinct from `timedOut` so callers can honor a user-supplied
   * threshold higher than the cap (we report the partial count, the gate
   * compares against the threshold, and large-but-bounded projects still
   * land on JIT correctly).
   */
  capHit: boolean;
}

export interface DetectProjectSizeOptions {
  /** Hard wall-clock cap. Defaults to `DEFAULT_DETECTION_TIMEOUT_MS`. */
  timeoutMs?: number;
  /**
   * Hard cap on file count. Once exceeded, the walk aborts early and
   * `capHit: true` is reported. Callers can compare the (partial)
   * `fileCount` against their threshold to decide JIT vs full mode.
   * Defaults to `DEFAULT_MAX_FILES_SCANNED`, but `detectProjectSize`
   * widens it proportionally when the env-var threshold is high.
   */
  maxFiles?: number;
}

/**
 * Zod schema for `<installDir>/.amplitude/events.json`. We only need to
 * validate the outer shape — the canonical parser
 * (`parseEventPlanContent`) already accepts a wide range of field-casing
 * variants. The schema rejects malformed JSON early so we don't burn
 * cycles parsing a file that will fail downstream anyway. On schema
 * mismatch we log a warning and return 0; the agent falls back to its
 * normal `read_file` exploration.
 */
const EventsFileSchema = z.union([
  z.array(z.unknown()),
  z.object({ events: z.array(z.unknown()).optional() }).passthrough(),
]);

/**
 * Walk `installDir` asynchronously counting files (excluding directories
 * in `SKIP_DIRECTORIES`). Stops as soon as `Date.now() - start` exceeds
 * `timeoutMs` (sets `timedOut: true`) OR `fileCount` exceeds `maxFiles`
 * (sets `capHit: true`). Distinct flags so callers can honor a user
 * threshold above the cap — `capHit` does NOT auto-imply "large project".
 *
 * Async by design: `fs.promises.readdir` lets the event loop service the
 * Ink renderer + the rest of cold-start while we walk. The earlier
 * `fs.readdirSync` version blocked the main thread for 1–4s on a large
 * monorepo, freezing the spinner and starving any concurrent network
 * calls.
 *
 * Why two caps: `timeoutMs` protects against pathological filesystems
 * (slow network mounts, huge breadth); `maxFiles` protects against the
 * common case of a healthy-but-large monorepo where we'd otherwise spend
 * multiple seconds enumerating files we already know we won't read.
 */
async function countSourceFiles(
  installDir: string,
  timeoutMs: number,
  maxFiles: number,
): Promise<{ fileCount: number; timedOut: boolean; capHit: boolean }> {
  const start = Date.now();
  let fileCount = 0;
  const stack: string[] = [installDir];

  while (stack.length > 0) {
    if (Date.now() - start > timeoutMs) {
      return { fileCount, timedOut: true, capHit: false };
    }
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      // Permission denied / vanished directory — skip silently. Detection
      // is best-effort; a partial count is still useful.
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        // Skip ALL dotted directories at any level (`.cache-foo`, `.next`,
        // bespoke `.something`) — they're either tool/IDE caches we don't
        // enumerate or generated artifacts. `SKIP_DIRECTORIES` already
        // handled the common named cases above; this is the catch-all.
        if (entry.name.startsWith('.')) continue;
        stack.push(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        fileCount += 1;
        if (fileCount > maxFiles) {
          // Bail mid-readdir — a wide flat directory can blow past the cap
          // without ever popping another stack entry. The outer loop's
          // cap check would then never fire.
          return { fileCount, timedOut: false, capHit: true };
        }
      }
      // Symlinks, sockets, etc. are intentionally not counted.
    }
  }

  return { fileCount, timedOut: false, capHit: false };
}

/** Read `<installDir>/.amplitude/events.json` and count parsed events. */
async function countConfirmedEvents(installDir: string): Promise<number> {
  const eventsPath = getEventsFile(installDir);
  let content: string;
  try {
    content = await fsp.readFile(eventsPath, 'utf8');
  } catch (err: unknown) {
    // ENOENT is expected when the user hasn't approved a plan yet.
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code !== 'ENOENT') {
      log.warn('events.json unreadable', { code, path: eventsPath });
    }
    return 0;
  }
  // Validate outer shape with zod before handing off to the canonical
  // parser. A schema mismatch here means the file is so malformed even
  // the lenient downstream parser will reject it; we log + return 0
  // rather than feeding garbage into the gate.
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    log.warn('events.json is not valid JSON', { path: eventsPath });
    return 0;
  }
  const validation = EventsFileSchema.safeParse(json);
  if (!validation.success) {
    log.warn('events.json failed schema validation', {
      path: eventsPath,
      'error message': validation.error.issues[0]?.message ?? 'unknown',
    });
    return 0;
  }
  const parsed = parseEventPlanContent(content);
  if (!parsed) return 0;
  return parsed.filter((e) => e.name.trim().length > 0).length;
}

/**
 * Inspect the project on disk and report the signals the pre-flight gate
 * needs. Async + best-effort; never throws.
 *
 * The effective `maxFiles` is widened proportionally when the active
 * file-count threshold (resolved from env vars at call time, or the
 * caller-supplied option) exceeds the default cap. This prevents a user
 * setting `AMPLITUDE_WIZARD_PREFLIGHT_FILE_THRESHOLD=2000` from being
 * silently capped at 500 — the scan budget grows to `2 × threshold` so
 * the gate decision is informed by enough of the tree to be meaningful.
 */
export async function detectProjectSize(
  installDir: string,
  options: DetectProjectSizeOptions = {},
): Promise<ProjectSizeReport> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DETECTION_TIMEOUT_MS;
  // Widen the default cap proportionally if the user set a high threshold
  // via env-var. Without this, B1 fires: a 2000-file threshold gets
  // silently capped at the default 500 and the gate trips on every
  // project. An explicit `options.maxFiles` (test-only) is honored
  // verbatim — only the default is widened.
  let maxFiles: number;
  if (options.maxFiles !== undefined) {
    maxFiles = options.maxFiles;
  } else {
    const { fileThreshold } = resolveThresholds();
    maxFiles = Math.max(DEFAULT_MAX_FILES_SCANNED, fileThreshold * 2);
  }
  const [{ fileCount, timedOut, capHit }, eventCount] = await Promise.all([
    countSourceFiles(installDir, timeoutMs, maxFiles),
    countConfirmedEvents(installDir),
  ]);
  return { fileCount, eventCount, timedOut, capHit };
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
 * the active thresholds.
 *
 * - `timedOut: true` (wall-clock cap fired) always lands on JIT — large
 *   codebases shouldn't pay a probe tax to figure out they're large.
 * - `capHit: true` (file-count cap fired) does NOT auto-trip JIT — the
 *   partial `fileCount` is compared against the threshold like any
 *   other count, so a user-supplied threshold higher than the cap is
 *   honored. The caller may still observe the partial count is below
 *   their threshold and stay on full mode.
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
