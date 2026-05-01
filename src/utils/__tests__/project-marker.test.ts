/**
 * Unit tests for the project-root marker guard.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { checkProjectGuard } from '../project-marker.js';

describe('checkProjectGuard', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amp-project-marker-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('passes when a package.json is present at the root', () => {
    fs.writeFileSync(path.join(tmp, 'package.json'), '{}');
    const result = checkProjectGuard(tmp);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.markers).toContain('package.json');
  });

  it('passes for any one of the recognized markers', () => {
    fs.writeFileSync(path.join(tmp, 'pyproject.toml'), '');
    const result = checkProjectGuard(tmp);
    expect(result.ok).toBe(true);
  });

  it('fails with no_project_marker when the dir has no manifest', () => {
    const result = checkProjectGuard(tmp);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_project_marker');
  });

  it('fails with install_dir_missing when the dir does not exist', () => {
    const result = checkProjectGuard(path.join(tmp, 'does-not-exist'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('install_dir_missing');
  });

  it('fails with is_home_dir even when $HOME has a package.json', () => {
    // Inject the tmp dir as homedir so the home-dir gate fires even
    // though we just dropped a package.json there. ESM forbids
    // spying on `os.homedir` directly (the export descriptor is
    // non-configurable), so we use `checkProjectGuard`'s injectable
    // homedir parameter.
    fs.writeFileSync(path.join(tmp, 'package.json'), '{}');
    const result = checkProjectGuard(tmp, tmp);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('is_home_dir');
  });

  it('fails with is_filesystem_root for `/`', () => {
    const root = path.parse(tmp).root; // `/` on POSIX, `C:\\` on Windows
    const result = checkProjectGuard(root);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('is_filesystem_root');
  });

  it('passes when both a marker and a non-home parent are present', () => {
    // Sanity test: tmp dir has a package.json, is not $HOME, is not /
    fs.writeFileSync(path.join(tmp, 'package.json'), '{}');
    const result = checkProjectGuard(tmp);
    expect(result.ok).toBe(true);
  });

  it('returns the matched markers (multiple OK)', () => {
    fs.writeFileSync(path.join(tmp, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmp, 'go.mod'), '');
    const result = checkProjectGuard(tmp);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.markers).toContain('package.json');
      expect(result.markers).toContain('go.mod');
    }
  });

  // ── Regression: Unity & Unreal projects were rejected ────────────────
  //
  // FRAMEWORK_REGISTRY supports both, but `PROJECT_MARKER_FILES` only
  // covered top-level fixed-name manifests. Unity's marker lives in a
  // sub-path (`ProjectSettings/ProjectVersion.txt`) and Unreal's
  // filename varies (`<ProjectName>.uproject`). Every Unity/Unreal user
  // hit `no_project_marker` and was told to pass `--force` even though
  // the framework is fully supported. Lock both paths in.

  it('passes for a Unity project (ProjectSettings/ProjectVersion.txt)', () => {
    const settingsDir = path.join(tmp, 'ProjectSettings');
    fs.mkdirSync(settingsDir);
    fs.writeFileSync(
      path.join(settingsDir, 'ProjectVersion.txt'),
      'm_EditorVersion: 2022.3.0f1\n',
    );
    const result = checkProjectGuard(tmp);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.markers).toContain('ProjectSettings/ProjectVersion.txt');
    }
  });

  it('passes for an Unreal project (.uproject file at root)', () => {
    fs.writeFileSync(path.join(tmp, 'MyGame.uproject'), '{}');
    const result = checkProjectGuard(tmp);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.markers).toContain('MyGame.uproject');
    }
  });

  it('passes for an Unreal project with a different .uproject name', () => {
    // Confirms the extension match isn't tied to a specific filename.
    fs.writeFileSync(path.join(tmp, 'OtherProject.uproject'), '{}');
    const result = checkProjectGuard(tmp);
    expect(result.ok).toBe(true);
  });

  it('does NOT match an unrelated extension that happens to be present', () => {
    // Sanity: only `.uproject` (and other registered extensions) count.
    // `.json` should not be enough on its own.
    fs.writeFileSync(path.join(tmp, 'random.json'), '{}');
    const result = checkProjectGuard(tmp);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_project_marker');
  });
});
