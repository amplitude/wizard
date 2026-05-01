/**
 * install-dir — shared helpers for resolving and validating an install
 * directory path entered by the user.
 *
 * Used by:
 *   - The IntroScreen `PathInput` (text input)
 *   - The IntroScreen `DirectoryPicker` (filesystem navigator)
 *   - The `--install-dir` CLI flag handling (run.ts / wizard-session.ts)
 *
 * Keeping this in one place means every entry point gets identical
 * behavior: `~` expansion, relative-path resolution, and a single source
 * of truth for "is this a directory the wizard can point at?".
 *
 * Why this matters: `path.resolve('~/foo')` on POSIX does NOT expand
 * `~`. Node treats `~` as a literal directory name and joins it onto
 * cwd, so a user who runs
 *
 *     npx @amplitude/wizard --install-dir="~/random-testing/makeapp"
 *
 * from `~/excalidraw` ends up with `installDir` set to
 * `~/excalidraw/~/random-testing/makeapp` — both wrong directory AND
 * the rendered "Target" line shows the bogus concatenation. The shell
 * normally expands `~` for us, but only when the value is unquoted.
 * Quoted values, env-var-sourced values (AMPLITUDE_WIZARD_INSTALL_DIR),
 * and values typed into the in-app PathInput all bypass shell expansion
 * and reach Node verbatim.
 *
 * Pure-ish: `resolveUserPath` / `resolveInstallDir` are pure string
 * transforms; `validatePath` does sync filesystem reads (statSync) and
 * returns a tagged union so the caller can render distinct copy for
 * each failure mode.
 */

import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

/**
 * Expand a leading `~` to the user's home directory. Both `~/foo` and
 * `~\foo` are accepted — the backslash form matters on Windows because
 * `shortenHomePath` produces paths separated by `path.sep`. A bare `~`
 * resolves to the home directory itself.
 *
 * Does not expand `$VAR` or other shell metacharacters — a literal `$`
 * in a directory name is more common than the env-var case for an
 * already-typed path, and silently expanding it would surprise users.
 */
export function expandTilde(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    // Slice past the `~` only — keep the separator so `path.resolve`
    // gets a properly-formed argument on either platform.
    return homedir() + trimmed.slice(1);
  }
  return trimmed;
}

/**
 * Resolve a user-typed path into an absolute path on disk.
 *
 * Steps:
 *   1. Trim whitespace (a copy-pasted path with a trailing newline is
 *      a real failure mode).
 *   2. Expand a leading `~` to the user's home directory. Without that
 *      branch, the seeded default value from `shortenHomePath(installDir)`
 *      would fail to round-trip: pressing Enter without editing would
 *      resolve `~/foo` against `cwd` as a relative path and the directory
 *      lookup would fail.
 *   3. Resolve relative paths against `cwd` so `./foo` and `../foo` work
 *      from wherever the wizard was launched.
 */
export function resolveUserPath(input: string): string {
  const expanded = expandTilde(input);
  return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
}

/**
 * Trust-boundary helper for `--install-dir` (and `AMPLITUDE_WIZARD_INSTALL_DIR`).
 *
 * Differs from `resolveUserPath` in two ways: accepts `undefined` / `null`
 * / empty (defaults to cwd) and lets the caller override `cwd` for tests.
 * Use this from any non-UI entry point where a raw user path crosses
 * into the wizard's session state. After this, downstream code can
 * assume `installDir` is an absolute path on disk.
 */
export function resolveInstallDir(
  input: string | undefined | null,
  cwd: string = process.cwd(),
): string {
  if (input === undefined || input === null || input.trim() === '') {
    return resolve(cwd);
  }
  const expanded = expandTilde(input);
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

/**
 * Validation result for a single resolved path.
 *
 * Tagged union so callers can render distinct copy for each `reason`.
 * The resolved absolute path is preserved on success so the caller
 * doesn't have to re-resolve.
 */
export type ValidationResult =
  | { ok: true; absolutePath: string }
  | { ok: false; reason: string };

/**
 * Validate a user-typed path. Resolves it first (so `~` and relative
 * forms are honored) and then checks that the target exists and is a
 * directory. Never throws.
 */
export function validatePath(input: string): ValidationResult {
  if (!input.trim()) {
    return { ok: false, reason: 'Enter a path.' };
  }
  const absolutePath = resolveUserPath(input);
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(absolutePath);
  } catch {
    return {
      ok: false,
      reason: `No directory at ${absolutePath}.`,
    };
  }
  if (!stats.isDirectory()) {
    return {
      ok: false,
      reason: `${absolutePath} is a file, not a directory.`,
    };
  }
  return { ok: true, absolutePath };
}
