/**
 * workspace-analysis — unit coverage.
 *
 * The IntroScreen surfaces an ambiguity warning before the user pulls
 * the trigger on the agent run. These tests pin the analyzer's
 * behavior so that screen never lies about the directory it's about
 * to instrument.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { analyzeWorkspace, shortenHomePath } from '../workspace-analysis.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wizard-workspace-analysis-'));
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe('analyzeWorkspace — manifest detection', () => {
  it('flags hasManifest=false in an empty directory', () => {
    const result = analyzeWorkspace(dir);
    expect(result.hasManifest).toBe(false);
    expect(result.isMonorepo).toBe(false);
  });

  it('detects package.json as a manifest', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x' }));
    expect(analyzeWorkspace(dir).hasManifest).toBe(true);
  });

  it('detects pyproject.toml', () => {
    writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "x"\n');
    expect(analyzeWorkspace(dir).hasManifest).toBe(true);
  });

  it('detects go.mod', () => {
    writeFileSync(join(dir, 'go.mod'), 'module x\n');
    expect(analyzeWorkspace(dir).hasManifest).toBe(true);
  });

  it('detects *.uproject for Unreal projects', () => {
    writeFileSync(join(dir, 'MyGame.uproject'), '{}');
    expect(analyzeWorkspace(dir).hasManifest).toBe(true);
  });

  it('detects Unity via ProjectSettings/ProjectVersion.txt', () => {
    mkdirSync(join(dir, 'ProjectSettings'));
    writeFileSync(
      join(dir, 'ProjectSettings/ProjectVersion.txt'),
      'm_EditorVersion: 2022.3.0f1\n',
    );
    expect(analyzeWorkspace(dir).hasManifest).toBe(true);
  });

  it('returns hasManifest=false for a non-existent directory', () => {
    const result = analyzeWorkspace(join(dir, 'does-not-exist'));
    expect(result.hasManifest).toBe(false);
    expect(result.isMonorepo).toBe(false);
  });
});

describe('analyzeWorkspace — monorepo detection', () => {
  it('flags package.json with a workspaces array as a monorepo', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'root', workspaces: ['packages/*', 'apps/*'] }),
    );
    const result = analyzeWorkspace(dir);
    expect(result.isMonorepo).toBe(true);
    expect(result.workspaceGlobs).toEqual(['packages/*', 'apps/*']);
  });

  it('flags the yarn-style { workspaces: { packages: [...] } } shape', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'root',
        workspaces: { packages: ['packages/*'] },
      }),
    );
    const result = analyzeWorkspace(dir);
    expect(result.isMonorepo).toBe(true);
    expect(result.workspaceGlobs).toEqual(['packages/*']);
  });

  it('parses pnpm-workspace.yaml', () => {
    writeFileSync(
      join(dir, 'pnpm-workspace.yaml'),
      `packages:\n  - 'packages/*'\n  - "apps/*"\n  - tools/*\n`,
    );
    const result = analyzeWorkspace(dir);
    expect(result.isMonorepo).toBe(true);
    expect(result.workspaceGlobs).toEqual(['packages/*', 'apps/*', 'tools/*']);
  });

  it('flags a turbo.json as a monorepo even without explicit workspace globs', () => {
    writeFileSync(join(dir, 'turbo.json'), '{}');
    const result = analyzeWorkspace(dir);
    expect(result.isMonorepo).toBe(true);
    expect(result.workspaceGlobs).toEqual([]);
  });

  it('flags lerna.json as a monorepo marker', () => {
    writeFileSync(join(dir, 'lerna.json'), '{}');
    expect(analyzeWorkspace(dir).isMonorepo).toBe(true);
  });

  it('flags nx.json as a monorepo marker', () => {
    writeFileSync(join(dir, 'nx.json'), '{}');
    expect(analyzeWorkspace(dir).isMonorepo).toBe(true);
  });

  it('does NOT flag a plain package.json without workspaces as a monorepo', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'normal-app' }),
    );
    const result = analyzeWorkspace(dir);
    expect(result.isMonorepo).toBe(false);
    expect(result.hasManifest).toBe(true);
  });

  it('caps workspaceGlobs at 10 entries to keep the UI from blowing up', () => {
    const globs = Array.from({ length: 25 }, (_, i) => `pkg-${i}/*`);
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'r', workspaces: globs }),
    );
    expect(analyzeWorkspace(dir).workspaceGlobs).toHaveLength(10);
  });
});

describe('shortenHomePath', () => {
  it('replaces the home prefix with a tilde', () => {
    const home = homedir();
    expect(shortenHomePath(join(home, 'projects', 'my-app'))).toBe(
      join('~', 'projects', 'my-app'),
    );
  });

  it('returns "~" exactly when the path IS the home dir', () => {
    expect(shortenHomePath(homedir())).toBe('~');
  });

  it('leaves paths outside the home directory untouched', () => {
    expect(shortenHomePath('/etc/hosts')).toBe('/etc/hosts');
  });
});
