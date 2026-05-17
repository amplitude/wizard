/**
 * plan-io — shared filesystem helpers for the plan modules
 * (`event-plan-parser`, `dashboard-plan`, `agent-plans`).
 *
 * Before this module each plan reader open-coded the same five-step shape:
 *
 *   1. `fs.readFileSync` with ENOENT vs other-error distinction
 *   2. `JSON.parse` with try/catch
 *   3. Zod `safeParse`
 *   4. log + return null on any failure
 *   5. caller pulls `result.data` out
 *
 * That worked but meant every new plan format had to reinvent the same
 * boilerplate (~25 lines per reader) and pick its own error labels.
 * `readJsonWithSchema` collapses the whole sequence into a single typed
 * call so the readers can focus on what's distinctive — the schema and
 * the dispatch on `kind`.
 *
 * Sync, not async, because every existing plan reader is sync (the modules
 * are imported by both CLI commands and TUI event handlers where switching
 * to a promise would cascade through callers for no benefit).
 *
 * Logging goes through `logToFile` for consistency with the prior open-
 * coded versions; callers pass a `label` so the log lines remain
 * identifiable (`readDashboardPlan: …` vs `loadPlan: …`).
 */
import * as fs from 'node:fs';
import type { ZodType } from 'zod';
import { logToFile } from '../utils/debug.js';

/**
 * Result of {@link readJsonWithSchema}. The `kind` field lets callers
 * distinguish "file isn't there yet" (often a happy path — the plan
 * hasn't been written) from "file is there but malformed" (a bug or
 * concurrent write).
 *
 * `not_found` mirrors `ENOENT`. Every other I/O error (EACCES, EISDIR,
 * etc.) collapses to `invalid` with the underlying message in `reason`.
 */
export type ReadJsonResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'not_found' }
  | { kind: 'invalid'; reason: string };

/**
 * Read a JSON file from disk and validate it against a Zod schema.
 *
 * Returns a discriminated union so callers can map each failure mode to
 * the right behavior (silent fall-through for missing files, error
 * surfacing for malformed plans, etc.). Never throws.
 *
 * Logs a single line on any non-`not_found` failure with the supplied
 * `label` so the prior `logToFile` lines from individual readers stay
 * recognizable in the debug log.
 */
export function readJsonWithSchema<T>(
  filePath: string,
  schema: ZodType<T>,
  label: string,
): ReadJsonResult<T> {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { kind: 'not_found' };
    const reason = err instanceof Error ? err.message : String(err);
    logToFile(`${label}: read failed for ${filePath}: ${reason}`);
    return { kind: 'invalid', reason };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const reason =
      err instanceof Error
        ? `Plan file is not valid JSON: ${err.message}`
        : `Plan file is not valid JSON: ${String(err)}`;
    logToFile(`${label}: invalid JSON in ${filePath}: ${reason}`);
    return { kind: 'invalid', reason };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const reason = `Plan failed schema validation: ${result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')}`;
    logToFile(
      `${label}: schema validation failed for ${filePath}: ${result.error.message}`,
    );
    return { kind: 'invalid', reason };
  }

  return { kind: 'ok', data: result.data };
}
