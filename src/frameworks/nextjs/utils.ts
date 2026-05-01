import fg from 'fast-glob';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WizardOptions } from '../../utils/types';
import { createVersionBucket } from '../../utils/semver';

export const getNextJsVersionBucket = createVersionBucket();

export enum NextJsRouter {
  APP_ROUTER = 'app-router',
  PAGES_ROUTER = 'pages-router',
}

export const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/public/**',
  '**/.next/**',
];

/**
 * Detect Next.js router type. Pure — returns null if ambiguous.
 */
export async function getNextJsRouter({
  installDir,
}: Pick<WizardOptions, 'installDir'>): Promise<NextJsRouter | null> {
  const pagesMatches = await fg('**/pages/_app.@(ts|tsx|js|jsx)', {
    dot: true,
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  const hasPagesDir = pagesMatches.length > 0;

  const appMatches = await fg('**/app/**/layout.@(ts|tsx|js|jsx)', {
    dot: true,
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  const hasAppDir = appMatches.length > 0;

  if (hasPagesDir && !hasAppDir) {
    return NextJsRouter.PAGES_ROUTER;
  }

  if (hasAppDir && !hasPagesDir) {
    return NextJsRouter.APP_ROUTER;
  }

  // Ambiguous (both or neither) — return null, SetupScreen handles it
  return null;
}

export const getNextJsRouterName = (router: NextJsRouter) => {
  return router === NextJsRouter.APP_ROUTER ? 'app router' : 'pages router';
};

/**
 * Concrete surface signals for a Next.js project — used to give the agent
 * deterministic instructions about which SDK(s) to install instead of
 * relying on its own LLM judgment from a partial directory scan.
 *
 * Without these flags the agent regularly mis-classified pages-router apps
 * with even a single API route (e.g. `pages/api/hello.ts`) as "API only"
 * and skipped the browser SDK entirely, even when the project had a normal
 * `pages/index.tsx` next door.
 */
export interface NextJsSurfaces {
  /**
   * Project has user-facing pages — i.e. anything the browser actually
   * renders. App Router: `app/**\/page.{ts,tsx,js,jsx}`. Pages Router:
   * any `.tsx`/`.jsx`/`.ts`/`.js` directly under `pages/` that isn't an
   * API route, `_app`, or `_document`.
   */
  hasBrowserSurface: boolean;
  /**
   * Project has server-side surfaces that should emit events from the
   * server runtime — API routes, route handlers, server actions wrappers,
   * or middleware.
   */
  hasServerSurface: boolean;
  /**
   * Project uses the `src/` layout convention. When true, instrumentation
   * files (instrumentation.ts, instrumentation-client.ts) and any new
   * server helpers (e.g. lib/amplitude-server.ts) MUST live inside `src/`
   * so they're co-located with the rest of the code; otherwise place them
   * at the project root. Mixing the two is what produced the
   * "instrumentation-client.ts at root, server in src/lib" inconsistency.
   */
  usesSrcDir: boolean;
}

export async function detectNextJsSurfaces({
  installDir,
}: Pick<WizardOptions, 'installDir'>): Promise<NextJsSurfaces> {
  // App Router pages: any file matching `<root>/app/**/page.{ts,tsx,js,jsx}`
  // or `src/app/**/page.{...}`. layout.tsx alone doesn't render content.
  const appPagesMatches = await fg('**/app/**/page.@(ts|tsx|js|jsx)', {
    dot: true,
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  // Pages Router pages: anything under pages/ that's NOT under pages/api,
  // and isn't a Next.js framework file (_app/_document/_error/_*). We scan
  // both `pages/` and `src/pages/` for either layout.
  const pagesAllMatches = await fg('**/pages/**/*.@(ts|tsx|js|jsx)', {
    dot: true,
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });
  const browserPagesMatches = pagesAllMatches.filter((p) => {
    // Drop anything under any pages/api/ subtree
    if (/(^|\/)pages\/api\//.test(p)) return false;
    // Drop framework files: pages/_app, pages/_document, pages/_error, pages/_*
    const base = path.basename(p);
    if (base.startsWith('_')) return false;
    return true;
  });

  const hasBrowserSurface =
    appPagesMatches.length > 0 || browserPagesMatches.length > 0;

  // Server surfaces:
  //   App Router: app/**/route.{ts,tsx,js,jsx}
  //   Pages Router: pages/api/**/*.{ts,tsx,js,jsx}
  //   Either: middleware.{ts,js} (root or src/)
  const [appRoutes, apiRoutes, middlewareFiles] = await Promise.all([
    fg('**/app/**/route.@(ts|tsx|js|jsx)', {
      dot: true,
      cwd: installDir,
      ignore: IGNORE_PATTERNS,
    }),
    fg('**/pages/api/**/*.@(ts|tsx|js|jsx)', {
      dot: true,
      cwd: installDir,
      ignore: IGNORE_PATTERNS,
    }),
    fg('{,src/}middleware.@(ts|js)', {
      dot: true,
      cwd: installDir,
      ignore: IGNORE_PATTERNS,
    }),
  ]);
  const hasServerSurface =
    appRoutes.length > 0 || apiRoutes.length > 0 || middlewareFiles.length > 0;

  // src/ layout heuristic — Next.js officially supports either `src/pages`,
  // `src/app`, or any code under `src/` while leaving config at the root.
  // We treat the project as src-layout if either route directory or any
  // common code directory lives under `src/`.
  const srcCandidates = ['pages', 'app', 'lib', 'components'];
  const usesSrcDir = srcCandidates.some((sub) => {
    try {
      return fs.statSync(path.join(installDir, 'src', sub)).isDirectory();
    } catch {
      return false;
    }
  });

  return { hasBrowserSurface, hasServerSurface, usesSrcDir };
}
