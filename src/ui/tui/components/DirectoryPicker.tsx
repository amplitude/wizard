/**
 * DirectoryPicker — interactive filesystem navigator for the
 * IntroScreen "Change directory" flow.
 *
 * Why this exists alongside `PathInput`:
 *   - Typing absolute paths is friction. New users coming off a brew /
 *     curl install often don't know where their project lives by full
 *     path; they just know "it's the one I was just in".
 *   - The text input flow (PathInput) silently rejects typos with a
 *     red error, which is dead-end UX when the user can't remember
 *     the exact spelling.
 *   - A directory list lets the user *see* what's reachable — the
 *     parent dir, sibling projects, common nesting patterns — and
 *     pick by visual recognition instead of recall.
 *
 * Behavior:
 *   - Starts at the wizard's current install dir (so the user can
 *     orient: "I'm here, where do I want to go?").
 *   - Up/Down arrows: move selection. Enter: descend into the selected
 *     directory, OR confirm if "Use this directory" is selected.
 *   - The first entry is always `..` (parent dir), pinned so it has
 *     a stable position regardless of contents.
 *   - The second entry is "Use this directory" — a sentinel that
 *     submits the *current* directory as the install dir. Without
 *     this, there's no way to pick the directory you're standing in.
 *   - `.` toggles hidden directories (off by default). Most users
 *     don't need to traverse `.git/` or `node_modules/`, but power
 *     users with dotfiles dirs do.
 *   - Esc: bail back to the IntroScreen action picker.
 *
 * Project markers: each directory entry gets a small annotation when
 * we detect a manifest file at its top level (`package.json`,
 * `pyproject.toml`, etc.). That's the highest-signal "is this an
 * instrumentable project?" hint we can give cheaply, and it surfaces
 * the right destination at a glance.
 *
 * All filesystem reads are sync. We don't traverse into subdirs or
 * recurse — listing one directory is fast on every platform we
 * support, and any deeper inspection would block the render.
 */

import { Box, Text } from 'ink';
import { useEffect, useMemo, useState } from 'react';
import { existsSync, readdirSync, type Dirent } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { homedir } from 'node:os';

import { PickerMenu } from '../primitives/index.js';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { Colors, Icons } from '../styles.js';
import { shortenHomePath } from '../../../lib/workspace-analysis.js';
import { createLogger } from '../../../lib/observability/logger.js';

const log = createLogger('directory-picker');

/**
 * Files that mark a directory as "looks like a project the wizard can
 * plausibly instrument". Mirrors `workspace-analysis.PROJECT_MANIFESTS`
 * but kept local so this component can render without taking on a
 * dependency on the analyzer (which loads more than we need for a
 * single-file check). Keep this list in sync if a new framework lands.
 */
const PROJECT_MARKER_FILES = [
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'setup.py',
  'Pipfile',
  'go.mod',
  'Cargo.toml',
  'Gemfile',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'composer.json',
  'Package.swift',
  'Podfile',
  'pubspec.yaml',
];

/** Sentinel values used in the picker. Plain strings, never paths. */
const SENTINEL = {
  /** "Use the current directory as the install dir." */
  CONFIRM: '__confirm__',
  /** "Go up to the parent directory." */
  PARENT: '__parent__',
} as const;

interface DirEntry {
  name: string;
  /** Absolute path to the directory. */
  path: string;
  /** True when the directory contains a known project manifest. */
  hasProjectMarker: boolean;
}

export interface DirectoryPickerProps {
  /** Where to start browsing. Falls back to home dir if it doesn't exist. */
  initialDir: string;
  /** Called with the absolute path of the directory the user confirmed. */
  onSubmit: (absolutePath: string) => void;
  /** Called when the user presses Esc to bail. */
  onCancel: () => void;
}

/**
 * Cheap project-marker check. Reads only file existence — no parsing,
 * no recursion, no JSON. Returns false for any unreadable entry so the
 * picker keeps rendering even on dirs the user can't fully inspect.
 */
function hasProjectMarker(dir: string): boolean {
  for (const marker of PROJECT_MARKER_FILES) {
    try {
      if (existsSync(join(dir, marker))) return true;
    } catch {
      /* ignore — keep scanning */
    }
  }
  return false;
}

/**
 * List immediate subdirectories of `dir`. Hidden dirs are filtered
 * unless `showHidden` is set. Errors are swallowed: the user might
 * navigate into a permission-denied dir, and the picker should show
 * an empty list with the parent / confirm sentinels intact rather
 * than crash.
 *
 * Sorted alphabetically (case-insensitive). Project-marked dirs are
 * NOT pinned to the top — sort stability beats relevance here, since
 * users scan alphabetically when looking for a known name.
 */
export function listSubdirectories(
  dir: string,
  showHidden: boolean,
): DirEntry[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    log.warn('failed to read directory', {
      dir,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const dirs: DirEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!showHidden && entry.name.startsWith('.')) continue;
    const absolutePath = join(dir, entry.name);
    dirs.push({
      name: entry.name,
      path: absolutePath,
      hasProjectMarker: hasProjectMarker(absolutePath),
    });
  }

  dirs.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
  return dirs;
}

/**
 * Resolve the picker's initial directory. The provided `initialDir`
 * is preferred, but we fall back to `homedir()` (and ultimately the
 * filesystem root if even that's missing) so the picker can always
 * render *something*. Calling code may pass a stale install dir
 * (e.g. a deleted project); silently degrading beats crashing the
 * intro screen.
 */
function resolveStartingDir(initialDir: string): string {
  try {
    if (initialDir && existsSync(initialDir)) return initialDir;
  } catch {
    /* fallthrough to home */
  }
  const home = homedir();
  if (home && existsSync(home)) return home;
  // Absolute last resort. POSIX root or Windows drive root via path.parse.
  return sep;
}

export const DirectoryPicker = ({
  initialDir,
  onSubmit,
  onCancel,
}: DirectoryPickerProps) => {
  const [currentDir, setCurrentDir] = useState(() =>
    resolveStartingDir(initialDir),
  );
  const [showHidden, setShowHidden] = useState(false);

  // Esc bails. `.` toggles hidden directories. Both keys must work
  // regardless of which option is currently highlighted, so they live
  // outside the PickerMenu's own input handling.
  useScreenInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (input === '.') {
      setShowHidden((prev) => !prev);
    }
  });

  const subdirs = useMemo(
    () => listSubdirectories(currentDir, showHidden),
    [currentDir, showHidden],
  );

  // The list renders three logical groups:
  //   1. "Use this directory" — confirms the current dir.
  //   2. ".." — go up one level. Hidden when we're already at the
  //      filesystem root (parent === self).
  //   3. The sorted list of subdirs.
  // Each subdir option's `value` is its absolute path; the two
  // sentinels use distinct string values that never collide with a
  // real path (paths always contain `/` or `\`).
  const parentDir = dirname(currentDir);
  const atRoot = parentDir === currentDir;

  const options = useMemo(() => {
    const opts: { label: string; value: string; hint?: string }[] = [
      {
        label: `${Icons.checkmark} Use this directory`,
        value: SENTINEL.CONFIRM,
        hint: 'pick the folder shown above',
      },
    ];
    if (!atRoot) {
      opts.push({
        label: '..  (go up)',
        value: SENTINEL.PARENT,
        hint: shortenHomePath(parentDir),
      });
    }
    for (const dir of subdirs) {
      opts.push({
        label: dir.hasProjectMarker
          ? `${dir.name}  ${Icons.dot} project`
          : dir.name,
        value: dir.path,
      });
    }
    return opts;
  }, [subdirs, atRoot, parentDir]);

  // Reset showHidden's effect on the cached options on each currentDir
  // change. Without this, navigating into a dir that has no hidden
  // entries leaves the toggle quietly inverted from the user's last
  // setting in a way that's hard to discover. We deliberately PRESERVE
  // the toggle state — the user opted in, they probably want it
  // sticky — but log it so debug traces explain "why are dotfiles
  // suddenly visible".
  useEffect(() => {
    log.debug('directory changed', {
      current: currentDir,
      'subdir count': subdirs.length,
      'show hidden': showHidden,
    });
  }, [currentDir, subdirs.length, showHidden]);

  return (
    <Box flexDirection="column" alignItems="flex-start">
      <Box flexDirection="column" marginBottom={1}>
        <Text color={Colors.heading}>Pick a directory</Text>
        <Box>
          <Text color={Colors.muted}>{Icons.dot} Currently in </Text>
          <Text color={Colors.body}>{shortenHomePath(currentDir)}</Text>
        </Box>
        <Text color={Colors.muted}>
          {Icons.dot} Enter to descend, select &quot;Use this directory&quot; to
          confirm. {showHidden ? 'Showing' : 'Hiding'} hidden — press{' '}
          <Text color={Colors.accentSecondary}>.</Text> to toggle. Esc to go
          back.
        </Text>
      </Box>

      <PickerMenu<string>
        options={options}
        onSelect={(value) => {
          const choice = Array.isArray(value) ? value[0] : value;
          if (choice === SENTINEL.CONFIRM) {
            onSubmit(currentDir);
            return;
          }
          if (choice === SENTINEL.PARENT) {
            setCurrentDir(parentDir);
            return;
          }
          // Any other value is a real subdirectory's absolute path.
          setCurrentDir(choice);
        }}
      />
    </Box>
  );
};
