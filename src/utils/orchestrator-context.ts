/**
 * Orchestrator-context loader.
 *
 * Reads the file referenced by `--context-file <path>` (or the
 * `AMPLITUDE_WIZARD_CONTEXT` env var) and returns its contents as a
 * UTF-8 string the wizard prepends to the inner-agent's system prompt.
 *
 * Surface area is deliberately tiny — the file's contents flow into
 * Claude system-prompt territory, so the loader's only jobs are:
 *
 *   1. Read the file (sync, blocking, before the agent starts).
 *   2. Cap the size at 64 KB so a runaway dump can't bloat every turn.
 *   3. Strip a UTF-8 BOM if present (editors silently insert one).
 *   4. Return a clean error envelope on failure so the CLI can decide
 *      whether to abort (TUI / classic) or emit `auth_required`-style
 *      structured rejection (agent / CI).
 *
 * Env-var fallback: if the user passes BOTH `--context-file` and
 * `AMPLITUDE_WIZARD_CONTEXT`, the CLI flag wins (consistent with the
 * rest of the wizard's flag-over-env precedence).
 */

import { readFileSync, statSync } from 'fs';
import { resolve } from 'path';

export const MAX_ORCHESTRATOR_CONTEXT_BYTES = 64 * 1024;

export type LoadOrchestratorContextResult =
  | { ok: true; content: string; sourcePath: string; bytes: number }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'too_large'
        | 'read_failed'
        | 'empty'
        | 'not_a_file';
      sourcePath: string;
      message: string;
    };

/**
 * Resolve the orchestrator-context source path: explicit `--context-file`
 * argument wins over `AMPLITUDE_WIZARD_CONTEXT`. Returns null when neither
 * is set so the caller can skip the read entirely.
 */
export function resolveOrchestratorContextPath(
  flagValue: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const fromFlag = flagValue?.trim();
  if (fromFlag && fromFlag.length > 0) return fromFlag;
  const fromEnv = env.AMPLITUDE_WIZARD_CONTEXT?.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return null;
}

export function loadOrchestratorContext(
  rawPath: string,
  cwd: string = process.cwd(),
): LoadOrchestratorContextResult {
  const sourcePath = resolve(cwd, rawPath);

  let stats;
  try {
    stats = statSync(sourcePath);
  } catch (err) {
    return {
      ok: false,
      reason: 'not_found',
      sourcePath,
      message: `Could not stat orchestrator context file: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
  if (!stats.isFile()) {
    return {
      ok: false,
      reason: 'not_a_file',
      sourcePath,
      message: `Orchestrator context path is not a regular file (got ${
        stats.isDirectory() ? 'directory' : 'special'
      }).`,
    };
  }
  if (stats.size > MAX_ORCHESTRATOR_CONTEXT_BYTES) {
    return {
      ok: false,
      reason: 'too_large',
      sourcePath,
      message: `Orchestrator context file is ${stats.size} bytes — exceeds the ${MAX_ORCHESTRATOR_CONTEXT_BYTES}-byte cap (every byte rides every agent turn).`,
    };
  }

  let raw: string;
  try {
    raw = readFileSync(sourcePath, 'utf8');
  } catch (err) {
    return {
      ok: false,
      reason: 'read_failed',
      sourcePath,
      message: `Could not read orchestrator context file: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  // Strip a UTF-8 BOM (U+FEFF) if present — editors silently insert one
  // and the model treats it as a stray character at the top of its
  // instructions. Use the \uFEFF escape rather than a raw BOM byte so
  // the source file stays ASCII-only and ESLint's
  // no-irregular-whitespace stops complaining.
  const stripped = raw.replace(/^\uFEFF/, '').trim();
  if (stripped.length === 0) {
    return {
      ok: false,
      reason: 'empty',
      sourcePath,
      message: 'Orchestrator context file is empty after trimming whitespace.',
    };
  }

  return {
    ok: true,
    content: stripped,
    sourcePath,
    bytes: Buffer.byteLength(stripped, 'utf8'),
  };
}
