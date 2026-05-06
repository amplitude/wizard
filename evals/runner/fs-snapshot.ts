/**
 * Filesystem snapshot + diff against a fixture's pristine baseline.
 *
 * Scorers consume the snapshot — they never walk the live working/ tree
 * directly. This is what lets historical artifacts be re-scored.
 *
 * The snapshot intentionally captures content hashes, not file contents.
 * Scorers that need contents read them on-demand from the working/ dir
 * THROUGH the runner's `readFromSnapshot` helper, which records the read
 * for later replay. (Helper landed in a follow-up commit; the type
 * signatures here are the contract.)
 */
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { FsSnapshot } from './types.js';

/**
 * Directories we never descend into when snapshotting. Keeps the artifact
 * size bounded and skips noisy churn (lockfiles changing inside
 * node_modules, build caches, etc).
 */
const PRUNE_DIRS = new Set<string>([
  'node_modules',
  '.git',
  '.next',
  '.expo',
  '.turbo',
  '.cache',
  'dist',
  'build',
  'coverage',
  '.amplitude',
]);

export async function snapshotDirectory(root: string): Promise<FsSnapshot> {
  const files: FsSnapshot['files'] = {};
  await walk(root, root, files);
  return {
    files,
    diff: { added: [], modified: [], deleted: [] },
  };
}

/**
 * Compute a diff of two snapshots. Used to compare working/ against the
 * fixture's pristine/ baseline.
 */
export function diffSnapshots(
  before: FsSnapshot,
  after: FsSnapshot,
): FsSnapshot['diff'] {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const [path, file] of Object.entries(after.files)) {
    const prior = before.files[path];
    if (!prior) added.push(path);
    else if (prior.sha256 !== file.sha256) modified.push(path);
  }
  for (const path of Object.keys(before.files)) {
    if (!after.files[path]) deleted.push(path);
  }

  added.sort();
  modified.sort();
  deleted.sort();
  return { added, modified, deleted };
}

async function walk(
  root: string,
  current: string,
  files: FsSnapshot['files'],
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.DS_Store')) continue;
    const abs = join(current, entry.name);
    if (entry.isDirectory()) {
      if (PRUNE_DIRS.has(entry.name)) continue;
      await walk(root, abs, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const rel = relative(root, abs).split(sep).join('/');
    const [content, st] = await Promise.all([readFile(abs), stat(abs)]);
    files[rel] = {
      sha256: createHash('sha256').update(content).digest('hex'),
      size: st.size,
    };
  }
}
