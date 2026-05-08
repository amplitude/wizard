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
 * Concrete workspace pick surfaced inline on the welcome screen when the
 * user lands on a monorepo root. Each entry is either a literal subdir
 * (`isWildcard: false`) — selecting it changes installDir to that path
 * directly — or a parent dir for a wildcard glob like `packages/*`
 * (`isWildcard: true`), which opens a sub-picker over the matching
 * children. We dedupe on `absolutePath` so the same dir doesn't show up
 * twice when both a `packages/*` glob and an explicit `packages/foo`
 * entry are declared.
 */
export interface WorkspacePick {
  /** Original glob string from the manifest (e.g. `packages/*`). */
  glob: string;
  /** Absolute path the pick resolves to. */
  absolutePath: string;
  /** Display label suitable for a picker row. */
  label: string;
  /** True when this pick should open a sub-picker rather than commit directly. */
  isWildcard: boolean;
}

/**
 * Translate the workspace globs from a monorepo manifest into concrete
 * inline picks for the welcome screen. We deliberately keep this list
 * small (default cap of 3) — the welcome menu is supposed to feel
 * tighter than a full file picker.
 *
 * Globs we handle:
 *   - `packages/foo` → literal subdir if it exists on disk
 *   - `packages/*`   → one wildcard entry whose label is the glob and
 *                      whose `absolutePath` is the parent dir; consumers
 *                      then list matching children themselves
 *
 * Anything else (`packages/!(legacy)`, `**\/*-app`, etc.) is dropped —
 * we'd rather skip a fancy glob than render a misleading pick.
 */
export function resolveWorkspacePicks(
  installDir: string,
  workspaceGlobs: string[],
  limit = 3,
): WorkspacePick[] {
  const seen = new Set<string>();
  const picks: WorkspacePick[] = [];

  for (const glob of workspaceGlobs) {
    if (picks.length >= limit) break;
    const trimmed = glob.trim();
    if (!trimmed) continue;

    // Wildcard glob — keep only the simple `parent/*` shape; anything
    // with extra glob meta (`!`, `**`, `?`, `{`, `[`) is too risky to
    // resolve here.
    if (trimmed.endsWith('/*')) {
      const parent = trimmed.slice(0, -2);
      if (/[*?!{[]/.test(parent)) continue;
      const abs = parent === '' ? installDir : join(installDir, parent);
      if (!safeExists(abs)) continue;
      if (seen.has(abs)) continue;
      seen.add(abs);
      picks.push({
        glob: trimmed,
        absolutePath: abs,
        label: trimmed,
        isWildcard: true,
      });
      continue;
    }

    // Literal entry — must exist on disk.
    if (/[*?!{[]/.test(trimmed)) continue;
    const abs = join(installDir, trimmed);
    if (!safeExists(abs)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    picks.push({
      glob: trimmed,
      absolutePath: abs,
      label: trimmed,
      isWildcard: false,
    });
  }

  return picks;
}

/**
 * List the immediate child directories of a wildcard parent (e.g.
 * `packages/*` → every dir inside `packages/`). Returns absolute paths
 * sorted alphabetically; non-directories and dotfiles are skipped.
 * Caller is responsible for filtering to directories that look like
 * real workspaces — we only care about layout here.
 */
export function listWildcardChildren(parentDir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(parentDir);
  } catch {
    return [];
  }
  const children: string[] = [];
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const abs = join(parentDir, name);
    try {
      if (statSync(abs).isDirectory()) children.push(abs);
    } catch {
      // best-effort; skip unreadable entries
    }
  }
  return children.sort();
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
