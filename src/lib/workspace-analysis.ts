/**
 * Workspace analysis — sync, fast checks that run against the install dir
 * during the IntroScreen render so the user gets an explicit warning when
 * they're about to point the wizard at an ambiguous or empty directory.
 *
 * Goal: prevent the "operate first, ask later" anti-pattern. Before any
 * agent-driven file edits happen, the wizard should be able to say:
 *   - "this looks like the wrong directory (no project manifest found)"
 *   - "this is a monorepo — pick a workspace, not the root"
 *
 * All checks are deliberately:
 *   - synchronous (runs in render, must be cheap)
 *   - filesystem-only (no spawn, no network)
 *   - failure-tolerant (every read is wrapped — analysis is best-effort)
 *
 * The result is informational only. The user decides whether to continue.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';

/**
 * Files that signal "this directory is the root of a project the wizard
 * can plausibly instrument". Covers every framework we support plus a few
 * adjacent ecosystems so we don't false-flag projects we have generic
 * guidance for.
 */
const PROJECT_MANIFESTS = [
  // JavaScript / TypeScript
  'package.json',
  // Python
  'requirements.txt',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'Pipfile',
  // Go
  'go.mod',
  // Rust
  'Cargo.toml',
  // Ruby
  'Gemfile',
  // Java / Kotlin
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  // PHP
  'composer.json',
  // Swift
  'Package.swift',
  'Podfile',
  // Flutter / Dart
  'pubspec.yaml',
  // .NET
  'global.json',
  // Unreal
  // (also detected via *.uproject below)
  // Unity
  // (detected via ProjectSettings/ProjectVersion.txt below)
];

/**
 * Glob-ish suffixes / nested files that also count as a project manifest.
 * Checked after the flat list above.
 */
const PROJECT_MANIFEST_PATTERNS: Array<(name: string) => boolean> = [
  (name) => name.endsWith('.uproject'), // Unreal
  (name) => name.endsWith('.xcodeproj'), // Swift / iOS
  (name) => name.endsWith('.csproj'), // .NET
  (name) => name.endsWith('.sln'), // .NET solution
];

const NESTED_MANIFESTS = [
  'ProjectSettings/ProjectVersion.txt', // Unity
];

/**
 * Files that indicate this is a JS/TS monorepo root. Pointing the wizard
 * at the monorepo root almost always means the user *meant* a specific
 * workspace inside it.
 *
 * Note: `pnpm-workspace.yaml` / `.yml` are NOT listed here because
 * `readPnpmWorkspaces` already checks both and returns non-null when
 * either exists — its result feeds the `isMonorepo` disjunction
 * directly. Adding them here would duplicate the existence check on
 * every `analyzeWorkspace` call. Same goes for `package.json`
 * `workspaces`, which `readPackageWorkspaces` covers.
 */
const MONOREPO_MARKERS = ['lerna.json', 'nx.json', 'turbo.json', 'rush.json'];

export interface WorkspaceAnalysis {
  /** Absolute path to the directory analyzed */
  absolutePath: string;
  /**
   * Human-friendly version of `absolutePath`: replaces the user's home
   * directory with `~`. Used in UI copy so the path stays scannable.
   */
  displayPath: string;
  /** True if at least one recognizable project manifest was found */
  hasManifest: boolean;
  /**
   * True if the directory looks like a multi-package monorepo root —
   * pnpm-workspaces, lerna, nx, turbo, rush, or a `package.json` with a
   * top-level `workspaces` field (npm/yarn).
   */
  isMonorepo: boolean;
  /**
   * The workspace globs declared in `package.json#workspaces` or
   * `pnpm-workspace.yaml`. Empty when the monorepo marker doesn't expose
   * a parseable list (e.g. lerna only, or YAML parse failure). Capped at
   * 10 entries so the UI doesn't blow up the layout.
   */
  workspaceGlobs: string[];
}

/** Sub the user's home dir with `~` so paths stay short in UI copy. */
export function shortenHomePath(absolutePath: string): string {
  const home = homedir();
  if (!home) return absolutePath;
  if (absolutePath === home) return '~';
  if (absolutePath.startsWith(home + sep)) {
    return '~' + absolutePath.slice(home.length);
  }
  return absolutePath;
}

function safeExists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

function safeReadJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function readPackageWorkspaces(installDir: string): string[] | null {
  const pkg = safeReadJson(join(installDir, 'package.json')) as {
    workspaces?: string[] | { packages?: string[] };
  } | null;
  if (!pkg) return null;
  if (Array.isArray(pkg.workspaces)) return pkg.workspaces;
  if (
    pkg.workspaces &&
    typeof pkg.workspaces === 'object' &&
    Array.isArray(pkg.workspaces.packages)
  ) {
    return pkg.workspaces.packages;
  }
  return null;
}

/**
 * Naive YAML reader: pnpm-workspace.yaml only declares a top-level
 * `packages:` list of strings. We don't want to take a hard YAML
 * dependency for this one file, so we hand-parse the obvious shape and
 * fall back to "monorepo, unknown globs" on anything fancier.
 */
function readPnpmWorkspaces(installDir: string): string[] | null {
  for (const file of ['pnpm-workspace.yaml', 'pnpm-workspace.yml']) {
    const path = join(installDir, file);
    if (!safeExists(path)) continue;
    try {
      const text = readFileSync(path, 'utf-8');
      const lines = text.split(/\r?\n/);
      const globs: string[] = [];
      let inPackages = false;
      for (const raw of lines) {
        const line = raw.replace(/#.*$/, '').trimEnd();
        if (!line.trim()) continue;
        if (/^packages\s*:/.test(line)) {
          inPackages = true;
          continue;
        }
        // Stop collecting once a new top-level key starts.
        if (inPackages && /^\S/.test(line) && !line.startsWith('-')) break;
        if (!inPackages) continue;
        const match = line.match(/^\s*-\s*['"]?([^'"]+?)['"]?\s*$/);
        if (match) globs.push(match[1]);
      }
      return globs;
    } catch {
      return [];
    }
  }
  return null;
}

function hasFlatManifest(installDir: string): boolean {
  let entries: string[];
  try {
    entries = readdirSync(installDir);
  } catch {
    return false;
  }
  const flatHits = entries.filter((name) => PROJECT_MANIFESTS.includes(name));
  if (flatHits.length > 0) return true;
  return entries.some((name) =>
    PROJECT_MANIFEST_PATTERNS.some((matches) => matches(name)),
  );
}

function hasNestedManifest(installDir: string): boolean {
  return NESTED_MANIFESTS.some((rel) => safeExists(join(installDir, rel)));
}

/**
 * Run all sync workspace checks against `installDir`.
 *
 * Never throws. On a missing or unreadable directory returns
 * `{ hasManifest: false, isMonorepo: false, workspaceGlobs: [] }` — the
 * caller should treat that the same way as "no manifest found" and
 * surface the warning.
 */
export function analyzeWorkspace(installDir: string): WorkspaceAnalysis {
  const absolutePath = installDir;
  const displayPath = shortenHomePath(absolutePath);

  let dirExists: boolean;
  try {
    dirExists = statSync(absolutePath).isDirectory();
  } catch {
    dirExists = false;
  }

  if (!dirExists) {
    return {
      absolutePath,
      displayPath,
      hasManifest: false,
      isMonorepo: false,
      workspaceGlobs: [],
    };
  }

  const hasManifest =
    hasFlatManifest(absolutePath) || hasNestedManifest(absolutePath);

  // Monorepo detection. Order matters — pnpm-workspace.yaml has the
  // richest signal (explicit globs) so we read it first.
  const pnpmGlobs = readPnpmWorkspaces(absolutePath);
  const pkgGlobs = readPackageWorkspaces(absolutePath);
  const otherMonorepoMarker = MONOREPO_MARKERS.some((name) =>
    safeExists(join(absolutePath, name)),
  );

  const isMonorepo =
    pnpmGlobs !== null || pkgGlobs !== null || otherMonorepoMarker;

  const workspaceGlobs = (pnpmGlobs ?? pkgGlobs ?? []).slice(0, 10);

  return {
    absolutePath,
    displayPath,
    hasManifest,
    isMonorepo,
    workspaceGlobs,
  };
}
