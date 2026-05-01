import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { detectBundler, hasIndexHtml } from '../utils.js';

// ── helpers ───────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'js-web-utils-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writePackageJson(
  deps: Record<string, string> = {},
  devDeps: Record<string, string> = {},
) {
  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ dependencies: deps, devDependencies: devDeps }),
    'utf-8',
  );
}

// ── detectBundler ─────────────────────────────────────────────────────────────

describe('detectBundler', () => {
  it('detects vite', () => {
    writePackageJson({}, { vite: '^4.0.0' });
    expect(detectBundler({ installDir: tmpDir })).toBe('vite');
  });

  it('detects webpack', () => {
    writePackageJson({}, { webpack: '^5.0.0' });
    expect(detectBundler({ installDir: tmpDir })).toBe('webpack');
  });

  it('detects esbuild', () => {
    writePackageJson({}, { esbuild: '^0.20.0' });
    expect(detectBundler({ installDir: tmpDir })).toBe('esbuild');
  });

  it('detects parcel', () => {
    writePackageJson({}, { parcel: '^2.0.0' });
    expect(detectBundler({ installDir: tmpDir })).toBe('parcel');
  });

  it('detects rollup', () => {
    writePackageJson({}, { rollup: '^4.0.0' });
    expect(detectBundler({ installDir: tmpDir })).toBe('rollup');
  });

  it('returns undefined when no bundler is found', () => {
    writePackageJson({ react: '^18.0.0' });
    expect(detectBundler({ installDir: tmpDir })).toBeUndefined();
  });

  it('returns undefined when package.json is missing', () => {
    expect(detectBundler({ installDir: tmpDir })).toBeUndefined();
  });

  it('returns undefined when package.json has invalid JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), 'not json', 'utf-8');
    expect(detectBundler({ installDir: tmpDir })).toBeUndefined();
  });

  it('prefers vite over webpack when both present', () => {
    writePackageJson({}, { vite: '^4.0.0', webpack: '^5.0.0' });
    expect(detectBundler({ installDir: tmpDir })).toBe('vite');
  });

  it('detects vite from optionalDependencies', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        optionalDependencies: { vite: '^5.0.0' },
      }),
      'utf-8',
    );
    expect(detectBundler({ installDir: tmpDir })).toBe('vite');
  });
});

// ── hasIndexHtml ──────────────────────────────────────────────────────────────

describe('hasIndexHtml', () => {
  it('returns true when index.html is in the root', () => {
    fs.writeFileSync(path.join(tmpDir, 'index.html'), '<html>', 'utf-8');
    expect(hasIndexHtml({ installDir: tmpDir })).toBe(true);
  });

  it('returns true when index.html is in a subdirectory', () => {
    const sub = path.join(tmpDir, 'src');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'index.html'), '<html>', 'utf-8');
    expect(hasIndexHtml({ installDir: tmpDir })).toBe(true);
  });

  it('returns false when no index.html exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'main.ts'), '', 'utf-8');
    expect(hasIndexHtml({ installDir: tmpDir })).toBe(false);
  });

  it('ignores index.html inside node_modules', () => {
    const nm = path.join(tmpDir, 'node_modules', 'some-pkg');
    fs.mkdirSync(nm, { recursive: true });
    fs.writeFileSync(path.join(nm, 'index.html'), '<html>', 'utf-8');
    expect(hasIndexHtml({ installDir: tmpDir })).toBe(false);
  });

  it('ignores index.html inside dist', () => {
    const dist = path.join(tmpDir, 'dist');
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, 'index.html'), '<html>', 'utf-8');
    expect(hasIndexHtml({ installDir: tmpDir })).toBe(false);
  });

  it('is case-insensitive for the filename (INDEX.HTML)', () => {
    fs.writeFileSync(path.join(tmpDir, 'INDEX.HTML'), '<html>', 'utf-8');
    expect(hasIndexHtml({ installDir: tmpDir })).toBe(true);
  });

  it('ignores index.html inside test directories', () => {
    for (const dir of ['e2e-tests', '__tests__', 'fixtures', 'examples']) {
      const sub = path.join(tmpDir, dir, 'app');
      fs.mkdirSync(sub, { recursive: true });
      fs.writeFileSync(path.join(sub, 'index.html'), '<html>', 'utf-8');
    }
    expect(hasIndexHtml({ installDir: tmpDir })).toBe(false);
  });
});
