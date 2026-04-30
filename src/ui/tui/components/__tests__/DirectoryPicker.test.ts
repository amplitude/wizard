/**
 * DirectoryPicker unit tests — exercise the pure `listSubdirectories`
 * helper.
 *
 * The component itself renders through Ink + PickerMenu which is
 * costly to test in isolation. The interesting logic is the directory
 * listing: hidden-dir filter, project-marker detection, and stable
 * alphabetical sort. All three are exposed via `listSubdirectories`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { listSubdirectories } from '../DirectoryPicker.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wizard-dir-picker-'));
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe('listSubdirectories', () => {
  it('returns immediate subdirectories sorted alphabetically (case-insensitive)', () => {
    mkdirSync(join(dir, 'beta'));
    mkdirSync(join(dir, 'Alpha'));
    mkdirSync(join(dir, 'gamma'));

    const result = listSubdirectories(dir, false);
    expect(result.map((d) => d.name)).toEqual(['Alpha', 'beta', 'gamma']);
  });

  it('hides dotfile directories by default', () => {
    mkdirSync(join(dir, 'visible'));
    mkdirSync(join(dir, '.git'));
    mkdirSync(join(dir, '.cache'));

    const result = listSubdirectories(dir, false);
    expect(result.map((d) => d.name)).toEqual(['visible']);
  });

  it('shows dotfile directories when showHidden is true', () => {
    mkdirSync(join(dir, 'visible'));
    mkdirSync(join(dir, '.git'));

    const result = listSubdirectories(dir, true);
    expect(result.map((d) => d.name).sort()).toEqual(['.git', 'visible']);
  });

  it('skips files', () => {
    mkdirSync(join(dir, 'subdir'));
    writeFileSync(join(dir, 'README.md'), 'hello');

    const result = listSubdirectories(dir, false);
    expect(result.map((d) => d.name)).toEqual(['subdir']);
  });

  it('flags directories that contain a project manifest', () => {
    const projectDir = join(dir, 'my-app');
    mkdirSync(projectDir);
    writeFileSync(join(projectDir, 'package.json'), '{}');

    const plainDir = join(dir, 'random-folder');
    mkdirSync(plainDir);

    const result = listSubdirectories(dir, false);
    const flags = Object.fromEntries(
      result.map((d) => [d.name, d.hasProjectMarker]),
    );
    expect(flags['my-app']).toBe(true);
    expect(flags['random-folder']).toBe(false);
  });

  it('returns an empty list for an unreadable directory', () => {
    const missing = join(dir, 'does-not-exist');
    expect(listSubdirectories(missing, false)).toEqual([]);
  });
});
