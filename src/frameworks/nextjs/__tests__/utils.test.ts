import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  detectNextJsSurfaces,
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

// ── detectNextJsSurfaces ─────────────────────────────────────────────────────

describe('detectNextJsSurfaces', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextjs-surfaces-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Regression for the "API-only" misclassification: a Pages Router app with
  // both src/pages/index.tsx AND src/pages/api/hello.ts must report a browser
  // surface, otherwise the agent skips the unified browser SDK.
  it('detects browser + server surfaces in a src/pages app with index + api', async () => {
    fs.mkdirSync(path.join(tmpDir, 'src', 'pages', 'api'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'pages', '_app.tsx'),
      '',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'pages', 'index.tsx'),
      '',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'pages', 'api', 'hello.ts'),
      '',
      'utf-8',
    );
    const surfaces = await detectNextJsSurfaces({ installDir: tmpDir });
    expect(surfaces.hasBrowserSurface).toBe(true);
    expect(surfaces.hasServerSurface).toBe(true);
    expect(surfaces.usesSrcDir).toBe(true);
  });

  it('reports server-only when only pages/api/* exists', async () => {
    fs.mkdirSync(path.join(tmpDir, 'pages', 'api'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'pages', 'api', 'hello.ts'),
      '',
      'utf-8',
    );
    const surfaces = await detectNextJsSurfaces({ installDir: tmpDir });
    expect(surfaces.hasBrowserSurface).toBe(false);
    expect(surfaces.hasServerSurface).toBe(true);
    expect(surfaces.usesSrcDir).toBe(false);
  });

  it('treats pages/_app.tsx and pages/_document.tsx as non-browser surfaces', async () => {
    // _app/_document are framework files, not user pages — without an actual
    // page, the project has nothing the browser would render.
    fs.mkdirSync(path.join(tmpDir, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'pages', '_app.tsx'), '', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, 'pages', '_document.tsx'), '', 'utf-8');
    const surfaces = await detectNextJsSurfaces({ installDir: tmpDir });
    expect(surfaces.hasBrowserSurface).toBe(false);
  });

  it('detects App Router page.tsx as a browser surface', async () => {
    fs.mkdirSync(path.join(tmpDir, 'app', 'about'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'app', 'layout.tsx'), '', 'utf-8');
    fs.writeFileSync(
      path.join(tmpDir, 'app', 'about', 'page.tsx'),
      '',
      'utf-8',
    );
    const surfaces = await detectNextJsSurfaces({ installDir: tmpDir });
    expect(surfaces.hasBrowserSurface).toBe(true);
    expect(surfaces.hasServerSurface).toBe(false);
  });

  it('detects App Router route.ts as a server surface', async () => {
    fs.mkdirSync(path.join(tmpDir, 'app', 'api', 'data'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'app', 'api', 'data', 'route.ts'),
      '',
      'utf-8',
    );
    const surfaces = await detectNextJsSurfaces({ installDir: tmpDir });
    expect(surfaces.hasServerSurface).toBe(true);
  });

  it('detects middleware.ts at the root as a server surface', async () => {
    fs.writeFileSync(path.join(tmpDir, 'middleware.ts'), '', 'utf-8');
    const surfaces = await detectNextJsSurfaces({ installDir: tmpDir });
    expect(surfaces.hasServerSurface).toBe(true);
  });

  it('reports usesSrcDir=true when src/lib exists even without pages/app', async () => {
    fs.mkdirSync(path.join(tmpDir, 'src', 'lib'), { recursive: true });
    const surfaces = await detectNextJsSurfaces({ installDir: tmpDir });
    expect(surfaces.usesSrcDir).toBe(true);
  });
});
