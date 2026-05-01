/**
 * Lightweight package.json reader used by framework detection.
 *
 * Detection runs early (before the TUI mounts) and is performance-critical:
 * loading any module that transitively imports `@amplitude/analytics-node`,
 * chalk, OAuth helpers, etc. dominates cold start. This module deliberately
 * depends on `node:fs` and `node:path` only so framework `detect()` callbacks
 * can read package.json without dragging the full `setup-utils` graph in.
 *
 * `setup-utils.ts` re-exports `tryGetPackageJson` from here for backward
 * compatibility with non-detection callers.
 */
import * as fs from 'node:fs';
import { join } from 'node:path';

import type { PackageDotJson } from './package-json';

interface InstallDirOptions {
  installDir: string;
}

/**
 * Try to read and parse package.json, returning null when it does not exist
 * or is invalid JSON. Use this for detection paths where a missing
 * package.json is expected (e.g. Python projects).
 */
export async function tryGetPackageJson({
  installDir,
}: InstallDirOptions): Promise<PackageDotJson | null> {
  try {
    const contents = await fs.promises.readFile(
      join(installDir, 'package.json'),
      'utf8',
    );
    const parsed: unknown = JSON.parse(contents);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as PackageDotJson;
  } catch {
    return null;
  }
}
