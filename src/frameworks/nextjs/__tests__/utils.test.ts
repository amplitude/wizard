import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getNextJsRouter,
  getNextJsRouterName,
  NextJsRouter,
} from '../utils.js';

// ── getNextJsRouterName ───────────────────────────────────────────────────────

describe('getNextJsRouterName', () => {
  it('returns "app router" for APP_ROUTER', () => {
    expect(getNextJsRouterName(NextJsRouter.APP_ROUTER)).toBe('app router');
  });

  it('returns "pages router" for PAGES_ROUTER', () => {
    expect(getNextJsRouterName(NextJsRouter.PAGES_ROUTER)).toBe('pages router');
  });
});

// ── getNextJsRouter ───────────────────────────────────────────────────────────

describe('getNextJsRouter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextjs-utils-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns PAGES_ROUTER when only pages/_app.tsx exists', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'pages', '_app.tsx'), '', 'utf-8');
    expect(await getNextJsRouter({ installDir: tmpDir })).toBe(
      NextJsRouter.PAGES_ROUTER,
    );
  });

  it('returns PAGES_ROUTER when only pages/_app.js exists', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'pages', '_app.js'), '', 'utf-8');
    expect(await getNextJsRouter({ installDir: tmpDir })).toBe(
      NextJsRouter.PAGES_ROUTER,
    );
  });

  it('returns APP_ROUTER when only app/layout.tsx exists', async () => {
    fs.mkdirSync(path.join(tmpDir, 'app'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'app', 'layout.tsx'), '', 'utf-8');
    expect(await getNextJsRouter({ installDir: tmpDir })).toBe(
      NextJsRouter.APP_ROUTER,
    );
  });

  it('returns APP_ROUTER when only app/layout.js exists', async () => {
    fs.mkdirSync(path.join(tmpDir, 'app'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'app', 'layout.js'), '', 'utf-8');
    expect(await getNextJsRouter({ installDir: tmpDir })).toBe(
      NextJsRouter.APP_ROUTER,
    );
  });

  it('returns null when both pages and app dirs exist (ambiguous)', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'pages', '_app.tsx'), '', 'utf-8');
    fs.mkdirSync(path.join(tmpDir, 'app'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'app', 'layout.tsx'), '', 'utf-8');
    expect(await getNextJsRouter({ installDir: tmpDir })).toBeNull();
  });

  it('returns null when neither dir exists', async () => {
    expect(await getNextJsRouter({ installDir: tmpDir })).toBeNull();
  });

  it('ignores _app.tsx inside node_modules', async () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'some-lib', 'pages'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tmpDir, 'node_modules', 'some-lib', 'pages', '_app.tsx'),
      '',
      'utf-8',
    );
    expect(await getNextJsRouter({ installDir: tmpDir })).toBeNull();
  });

  it('ignores layout.tsx inside dist', async () => {
    fs.mkdirSync(path.join(tmpDir, 'dist', 'app'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'dist', 'app', 'layout.tsx'),
      '',
      'utf-8',
    );
    expect(await getNextJsRouter({ installDir: tmpDir })).toBeNull();
  });
});
