/* Next.js wizard for Amplitude */
import type { WizardOptions } from '../../utils/types';
import type { FrameworkConfig } from '../../lib/framework-config';
import { detectNodePackageManagers } from '../../lib/package-manager-detection';
import { Integration } from '../../lib/constants';
import { BrandColors } from '../../lib/brand-colors';
import {
  getPackageVersion,
  hasPackageInstalled,
  type PackageDotJson,
} from '../../utils/package-json';
import { tryGetPackageJson } from '../../utils/setup-utils';
import { getUI } from '../../ui';
import { BROWSER_UNIFIED_SDK_PROMPT_LINE } from '../_shared/browser-sdk-prompt';
import {
  detectNextJsSurfaces,
  getNextJsRouter,
  getNextJsVersionBucket,
  getNextJsRouterName,
  NextJsRouter,
} from './utils';

type NextjsContext = {
  router?: NextJsRouter;
  /** Whether the project has user-facing pages (browser SDK is required). */
  hasBrowserSurface?: boolean;
  /** Whether the project has API routes / route handlers / middleware. */
  hasServerSurface?: boolean;
  /** Whether the project uses the `src/` layout convention. */
  usesSrcDir?: boolean;
};

export const NEXTJS_AGENT_CONFIG: FrameworkConfig<NextjsContext> = {
  metadata: {
    name: 'Next.js',
    glyph: '▲',
    glyphColor: BrandColors.gray10,
    integration: Integration.nextjs,
    targetsBrowser: true,
    docsUrl: 'https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2',
    unsupportedVersionDocsUrl:
      'https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2',
    gatherContext: async (options: WizardOptions) => {
      const router = await getNextJsRouter(options);
      // Always probe surfaces — they're independent of whether router
      // detection is unambiguous, and the agent prompt benefits from them
      // even when the user has to manually pick a router.
      const { hasBrowserSurface, hasServerSurface, usesSrcDir } =
        await detectNextJsSurfaces(options);
      if (router) {
        const emoji =
          router === NextJsRouter.APP_ROUTER ? '\u{1F4F1}' : '\u{1F4C3}';
        getUI().setDetectedFramework(
          `Next.js ${getNextJsRouterName(router)} ${emoji}`,
        );
        return { router, hasBrowserSurface, hasServerSurface, usesSrcDir };
      }
      return { hasBrowserSurface, hasServerSurface, usesSrcDir };
    },
    setup: {
      questions: [
        {
          key: 'router',
          message: 'Which Next.js router are you using?',
          options: [
            { label: 'App Router', value: NextJsRouter.APP_ROUTER },
            { label: 'Pages Router', value: NextJsRouter.PAGES_ROUTER },
          ],
          detect: async (opts) => {
            const result = await getNextJsRouter(opts);
            return result;
          },
        },
      ],
    },
    getIntegrationSkillId: (context) => {
      const router = context.router ?? NextJsRouter.APP_ROUTER;
      return router === NextJsRouter.PAGES_ROUTER
        ? 'integration-nextjs-pages-router'
        : 'integration-nextjs-app-router';
    },
  },

  detection: {
    packageName: 'next',
    packageDisplayName: 'Next.js',
    getVersion: (packageJson: unknown) =>
      getPackageVersion('next', packageJson as PackageDotJson),
    getVersionBucket: getNextJsVersionBucket,
    getInstalledVersion: async (options: WizardOptions) => {
      const packageJson = await tryGetPackageJson(options);
      return packageJson ? getPackageVersion('next', packageJson) : undefined;
    },
    detect: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      return packageJson ? hasPackageInstalled('next', packageJson) : false;
    },
    detectPackageManager: detectNodePackageManagers,
  },

  environment: {
    uploadToHosting: true,
    getEnvVars: (apiKey: string, _host: string) => ({
      NEXT_PUBLIC_AMPLITUDE_API_KEY: apiKey,
    }),
  },

  analytics: {
    getTags: (context) => ({
      router: context.router === NextJsRouter.APP_ROUTER ? 'app' : 'pages',
    }),
  },

  prompts: {
    projectTypeDetection:
      'This is a JavaScript/TypeScript project. Look for package.json and lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) to confirm.',
    getAdditionalContextLines: (context) => {
      const routerType =
        context.router === NextJsRouter.APP_ROUTER ? 'app' : 'pages';
      // Concrete surface signals computed by detectNextJsSurfaces. When
      // these flags are present the prompt uses MUST/MUST NOT language so
      // the agent doesn't have to re-derive the answer from a partial
      // directory scan. When they're absent (e.g. surface detection
      // failed), the prompt falls back to the legacy descriptive guidance.
      const surfaces: string[] = [];
      const knownSurfaces =
        context.hasBrowserSurface !== undefined ||
        context.hasServerSurface !== undefined;
      if (knownSurfaces) {
        const browser = context.hasBrowserSurface
          ? 'YES — install the unified browser SDK (@amplitude/unified) and wire it up in the client init point. Do NOT skip the browser SDK even if the project also has API routes.'
          : context.hasServerSurface
          ? 'NO browser-rendered pages detected — only install @amplitude/analytics-node.'
          : 'NO browser-rendered pages detected yet — install the unified browser SDK (@amplitude/unified) as the default since Next.js projects almost always add pages. Skip @amplitude/analytics-node unless the project also has server surfaces.';
        const server = context.hasServerSurface
          ? 'YES — install @amplitude/analytics-node in addition to the browser SDK and wire up server-side tracking for API routes, route handlers, server actions, and middleware.'
          : 'NO server surfaces detected — skip @amplitude/analytics-node entirely.';
        surfaces.push(
          `Browser surfaces present: ${browser}`,
          `Server surfaces present: ${server}`,
        );
      }
      // src/ layout: keep Amplitude files co-located with the project's
      // existing layout so we don't end up with `instrumentation-client.ts`
      // at the repo root next to a `src/lib/amplitude-server.ts` (the user
      // saw exactly that mismatch and called it confusing).
      const srcDirRule =
        context.usesSrcDir === true
          ? `File placement: this project uses the src/ layout. Place BOTH instrumentation files (instrumentation.ts and instrumentation-client.ts) AND any new server helper (e.g. amplitude-server.ts) inside src/ — never at the repo root. Co-locate them: e.g. src/instrumentation-client.ts and src/lib/amplitude-server.ts. Do NOT split them between root and src/.`
          : context.usesSrcDir === false
          ? `File placement: this project does NOT use the src/ layout. Place BOTH instrumentation files (instrumentation.ts and instrumentation-client.ts) at the repo root next to next.config.*, and any new server helper (e.g. lib/amplitude-server.ts) at the repo root in lib/. Do NOT introduce a src/ directory just for Amplitude.`
          : `File placement: keep instrumentation.ts and instrumentation-client.ts co-located in the SAME directory as each other (both at repo root, OR both inside src/) — match wherever the rest of this project's code lives. Mixing root and src/ between the two files is wrong.`;
      return [
        `Router: ${routerType}`,
        ...surfaces,
        srcDirRule,
        // Next.js apps almost always have BOTH a browser surface (pages,
        // client components, layouts) AND a server surface (API routes,
        // server actions, route handlers, getServerSideProps, middleware).
        // We want analytics to fire correctly from both — the unified
        // browser SDK on the client, and @amplitude/analytics-node on the
        // server — so the agent must wire up both halves when the project
        // has them. Skipping server-side instrumentation is the most
        // common gap in Next.js setups.
        BROWSER_UNIFIED_SDK_PROMPT_LINE,
        `Next.js init point: place the initAll(...) call in a 'use client' boundary — root layout for App Router, _app.tsx for Pages Router — so the SDK loads in the browser bundle and not in the server bundle. Importing @amplitude/unified from a server module will break the build.`,
        `Server SDK: @amplitude/analytics-node — install IN ADDITION to the browser SDK whenever the project has API routes (app/**/route.ts, pages/api/**), server actions, route handlers, middleware, or any other server-side surface that should emit events. Initialize once in a server-only module (e.g. lib/amplitude.server.ts) using the same API key, then import + call from server code. Do NOT import @amplitude/unified from server modules — it's browser-only and will break the build.`,
        `Project may need BOTH SDKs side by side. The browser SDK identifies users in the browser; the node SDK should attach the same user identity (user_id / device_id forwarded from the request) so events from both surfaces stitch into the same Amplitude user. If the project has zero server-side analytics surfaces (purely static / client-rendered with no API routes), skip the node SDK entirely — don't install it speculatively.`,
        `Reserved env var: NEXT_PUBLIC_AMPLITUDE_API_KEY (browser, exposed). Server-side code should read the same key from process.env — Next.js exposes any NEXT_PUBLIC_* var to both runtimes, so a single env var is fine for most projects.`,
      ];
    },
  },

  ui: {
    successMessage: 'Amplitude integration complete',
    estimatedDurationMinutes: 8,
    getOutroChanges: (context) => {
      const router = context.router ?? NextJsRouter.APP_ROUTER;
      const routerName = getNextJsRouterName(router);
      return [
        `Analyzed your Next.js project structure (${routerName})`,
        `Created and configured Amplitude initializers`,
        `Integrated Amplitude into your application`,
      ];
    },
    getOutroNextSteps: () => {
      return [
        'Start your development server to see Amplitude in action',
        'Visit your Amplitude dashboard to see incoming events',
      ];
    },
  },
};
