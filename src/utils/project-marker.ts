/**
 * Project-root marker detection.
 *
 * The wizard mutates files in `installDir`: it installs SDK dependencies,
 * writes init code, edits source files, persists `.amplitude/` metadata.
 * If the directory isn't actually a project root — the user invoked the
 * wizard from `$HOME`, from `~/dev/` (a multi-project parent), or from
 * a tmpdir — the wizard would scan thousands of files, instrument the
 * wrong codebase, or pollute the user's home dir with `.amplitude/`.
 *
 * We refuse to proceed in that case unless the caller passes `--force`.
 *
 * "Project root" is detected via the presence of any well-known package
 * manifest. The list is the union of what the wizard's `detect` flow
 * already supports (Next.js / Vue / React / Django / Flask / FastAPI /
 * Swift / RN / Android / Flutter / Go / Java / Unreal / Unity / Rails /
 * Laravel / Ruby / Python). One marker is enough.
 *
 * Pure module — no I/O at import time, no UI imports — so the rule can
 * be exercised in isolation by unit tests.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Filenames that indicate "this directory is a project root the wizard
 * can reasonably operate on." Add new ones when adding new framework
 * support — keep this list aligned with `FRAMEWORK_REGISTRY`.
 */
export const PROJECT_MARKER_FILES = [
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'Pipfile',
  'Cargo.toml',
  'go.mod',
  'Gemfile',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Package.swift',
  'pubspec.yaml',
  'composer.json',
] as const;

/**
 * Project markers that live one directory deeper than the install dir.
 * Unity projects keep their version file inside `ProjectSettings/`; the
 * top-level project root has no manifest at all by Unity convention,
 * so without this entry every Unity user is told "no project manifest"
 * even though the framework is supported and detected by
 * `detectUnityProject` (`src/frameworks/unity/utils.ts`).
 */
export const PROJECT_MARKER_PATHS = [
  // Unity 2017+ — present in every Unity project
  'ProjectSettings/ProjectVersion.txt',
] as const;

/**
 * Project markers identified by file extension at the install-dir root.
 * Unreal Engine names its project file `<ProjectName>.uproject` — the
 * exact filename varies, so a fixed-name match in `PROJECT_MARKER_FILES`
 * doesn't work. We do a single non-recursive `readdir` and check
 * extensions; the cost is bounded by the number of files at the root.
 */
export const PROJECT_MARKER_EXTENSIONS = [
  // Unreal Engine — project descriptor
  '.uproject',
] as const;

export type ProjectGuardResult =
  | { ok: true; markers: readonly string[] }
  | { ok: false; reason: ProjectGuardReason; details: string };

export type ProjectGuardReason =
  | 'is_home_dir'
  | 'is_filesystem_root'
  | 'no_project_marker'
  | 'install_dir_missing';

/**
 * Returns `{ ok: true }` when `installDir` looks like a project root the
 * wizard should operate on, or a structured failure with a reason and a
 * human-readable detail string. Pure — no side effects.
 *
 * Specific failure modes:
 *   - `is_home_dir`: installDir is exactly `os.homedir()`. Even if a
 *     marker is present (rare — `package.json` in `$HOME`), refuse,
 *     because the blast radius of `pnpm install` and `Write` tools in
 *     `$HOME` is unacceptable.
 *   - `is_filesystem_root`: installDir is `/`, `C:\`, or similar.
 *   - `no_project_marker`: directory exists but contains no recognized
 *     package manifest. Likely a multi-project parent dir (`~/dev/`)
 *     or a stray location.
 *   - `install_dir_missing`: directory does not exist.
 *
 * Callers can bypass with their own `--force` semantics.
 *
 * `homedir` is injectable for tests; production callers use the default.
 */
export function checkProjectGuard(
  installDir: string,
  homedir: string = os.homedir(),
): ProjectGuardResult {
  let resolved: string;
  try {
    resolved = path.resolve(installDir);
  } catch {
    return {
      ok: false,
      reason: 'install_dir_missing',
      details: `install dir is unresolvable: ${installDir}`,
    };
  }

  if (!fs.existsSync(resolved)) {
    return {
      ok: false,
      reason: 'install_dir_missing',
      details: `install dir does not exist: ${resolved}`,
    };
  }

  const home = path.resolve(homedir);
  if (resolved === home) {
    return {
      ok: false,
      reason: 'is_home_dir',
      details:
        'install dir is the user home directory. The wizard installs SDK ' +
        'dependencies and edits source files — this is almost never what you ' +
        'want from $HOME. Pass `--install-dir <abs-path>` pointing at a real ' +
        'project, or `--force` to bypass.',
    };
  }

  // Filesystem root — `/` on POSIX, `C:\\` etc. on Windows. `path.parse`
  // returns `root` for these cases.
  const parsed = path.parse(resolved);
  if (resolved === parsed.root) {
    return {
      ok: false,
      reason: 'is_filesystem_root',
      details: `install dir is the filesystem root (${resolved}). Pass --install-dir <abs-path> to a real project.`,
    };
  }

  // Look for at least one project marker at the top level. We do NOT
  // recurse: every framework the wizard supports places its manifest
  // either at the root, in a single fixed sub-path (Unity), or as a
  // root-level file with a known extension (Unreal).
  const found: string[] = [];
  for (const marker of PROJECT_MARKER_FILES) {
    if (fs.existsSync(path.join(resolved, marker))) {
      found.push(marker);
    }
  }
  for (const subPath of PROJECT_MARKER_PATHS) {
    if (fs.existsSync(path.join(resolved, subPath))) {
      found.push(subPath);
    }
  }
  if (PROJECT_MARKER_EXTENSIONS.length > 0) {
    // Single non-recursive readdir to find any extension-marker file at
    // the root. Wrapped in try/catch so a permissions error on the dir
    // (rare; install-dir was already `existsSync`-confirmed above) falls
    // through to the regular "no marker" path instead of blowing up.
    try {
      for (const entry of fs.readdirSync(resolved)) {
        const ext = path.extname(entry).toLowerCase();
        if (PROJECT_MARKER_EXTENSIONS.some((m) => m.toLowerCase() === ext)) {
          found.push(entry);
          break;
        }
      }
    } catch {
      // unreadable dir — skip, fall through to no-marker error below
    }
  }
  if (found.length === 0) {
    return {
      ok: false,
      reason: 'no_project_marker',
      details:
        `install dir has no project manifest (${PROJECT_MARKER_FILES.slice(
          0,
          5,
        ).join(', ')}…). ` +
        'This usually means you ran the wizard from a multi-project parent ' +
        'dir or the wrong path. Pass `--install-dir <abs-path>` pointing at ' +
        'the project root, or `--force` to bypass.',
    };
  }

  return { ok: true, markers: found };
}
