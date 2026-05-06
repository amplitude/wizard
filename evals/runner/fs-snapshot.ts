/**
 * Filesystem snapshot + diff helpers.
 *
 * Walks a fixture's working tree, hashes every file, and produces an
 * `FsSnapshot`. Diffs against a pristine baseline so scorers can ask
 * "did the agent touch this file" without re-running the wizard.
 *
 * Why not lean on `git diff`? Because (a) fixtures intentionally live
 * outside git tracking once they're cloned to a working dir, (b) the
 * pristine baseline is content-addressed, not commit-addressed, and
 * (c) the snapshot needs to round-trip cleanly through the artifact
 * JSON for replay scoring.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

import type { FsSnapshot } from './types.js';

/**
 * Directories we skip when walking a fixture. Keep this list tight —
 * if a scenario needs to track changes inside one of these, surface
 * it explicitly rather than silently expanding the walk.
 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.git',
  '.turbo',
  '.cache',
]);

/** Convert a path to forward-slash form for stable JSON. */
function toPosix(p: string): string {
  return p.split(sep).join(posix.sep);
}

/**
 * Walk `root` recursively, returning a map of repo-relative POSIX
 * paths to file metadata.
 */
export function snapshotDir(root: string): FsSnapshot['files'] {
  const out: FsSnapshot['files'] = {};
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        stack.push(full);
      } else if (ent.isFile()) {
        let buf: Buffer;
        try {
          buf = readFileSync(full);
        } catch {
          continue;
        }
        const relPath = toPosix(relative(root, full));
        out[relPath] = {
          sha256: createHash('sha256').update(buf).digest('hex'),
          size: statSync(full).size,
        };
      }
      // symlinks, sockets, etc. are intentionally skipped
    }
  }
  return out;
}

/**
 * Produce a diff against a pristine baseline. Three categories: added
 * (in working but not pristine), modified (in both, different sha),
 * deleted (in pristine but not working).
 *
 * Path lists are sorted so scorer reports diff stably across runs.
 */
export function diffSnapshots(
  pristine: FsSnapshot['files'],
  working: FsSnapshot['files'],
): FsSnapshot['diff'] {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  for (const path of Object.keys(working)) {
    if (!(path in pristine)) added.push(path);
    else if (working[path].sha256 !== pristine[path].sha256) {
      modified.push(path);
    }
  }
  for (const path of Object.keys(pristine)) {
    if (!(path in working)) deleted.push(path);
  }
  added.sort();
  modified.sort();
  deleted.sort();
  return { added, modified, deleted };
}

/**
 * Convenience helper: snapshot `working/` and compute the diff
 * against `pristine/`. Returns the full `FsSnapshot` shape.
 */
export function captureFsSnapshot(
  pristineDir: string,
  workingDir: string,
): FsSnapshot {
  const pristine = snapshotDir(pristineDir);
  const working = snapshotDir(workingDir);
  return {
    files: working,
    diff: diffSnapshots(pristine, working),
  };
}
