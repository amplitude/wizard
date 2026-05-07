/**
 * Cheap, sync python-project preflight.
 *
 * Every python framework detector (django, flask, fastapi, python) does
 * recursive `fast-glob('**\/manage.py')` / `fast-glob('**\/requirements*.txt')`
 * scans against the install dir. On a JS-heavy repo (e.g. anything with a
 * sizeable `node_modules`) those globs blow past the 10s detector timeout
 * even with `**\/node_modules/**` in `IGNORE_PATTERNS`, holding the welcome
 * screen at "Scanning…" for 10s+ minimum on every cold-start.
 *
 * This helper is a single fan-out of `fs.existsSync` against the install
 * directory root. If NONE of the canonical top-level python markers are
 * present, the project is definitively not a python project and the
 * recursive scan can be skipped. Returns true for any project that has at
 * least one marker at the root.
 *
 * Trade-off: monorepos where the python service lives in a subdirectory
 * (e.g. `services/api/manage.py`) and there's no top-level marker get
 * classified as non-python. The user can re-run with `--install-dir
 * services/api`. This was the de-facto behaviour anyway when the recursive
 * scan timed out; the explicit short-circuit just makes the failure mode
 * fast and visible instead of slow and confusing.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Top-level filenames that, when present in the install dir root, indicate
 * the project is (or contains) a python project. Subdirectories are NOT
 * scanned — that's the point.
 */
export const PYTHON_TOPLEVEL_MARKERS: ReadonlyArray<string> = Object.freeze([
  'manage.py',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'Pipfile',
  'Pipfile.lock',
  'poetry.lock',
  'requirements.txt',
  'requirements-dev.txt',
  'requirements-prod.txt',
  'requirements-test.txt',
  'uv.lock',
  // Pattern-match-by-prefix in `hasPythonProjectMarkers` for any other
  // `requirements*.txt`. Listing the common ones explicitly above keeps
  // the fast path branch-free.
]);

/**
 * Returns true when at least one top-level python marker exists under
 * `installDir`. Pure sync I/O — no globbing, no recursion. Safe to call
 * from a detect() hot path.
 */
export function hasPythonProjectMarkers(installDir: string): boolean {
  for (const marker of PYTHON_TOPLEVEL_MARKERS) {
    try {
      if (fs.existsSync(path.join(installDir, marker))) return true;
    } catch {
      // existsSync swallows most errors but be defensive on weird FS
      // states (broken symlinks, EACCES). Move on to the next marker.
      continue;
    }
  }

  // Catch-all for `requirements*.txt` variants we didn't list above.
  // Single readdir on the install dir root — no recursion.
  try {
    const entries = fs.readdirSync(installDir);
    for (const name of entries) {
      if (name.startsWith('requirements') && name.endsWith('.txt')) {
        return true;
      }
    }
  } catch {
    // readdir failure (permission, missing dir) → treat as no markers.
  }

  return false;
}
