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
import {
  getNextJsRouter,
  getNextJsVersionBucket,
  getNextJsRouterName,
  NextJsRouter,
} from './utils';

type NextjsContext = {
  router?: NextJsRouter;
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
      if (router) {
        const emoji =
          router === NextJsRouter.APP_ROUTER ? '\u{1F4F1}' : '\u{1F4C3}';
        getUI().setDetectedFramework(
          `Next.js ${getNextJsRouterName(router)} ${emoji}`,
        );
        return { router };
      }
      return {};
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
      return [
        `Router: ${routerType}`,
        // Next.js apps almost always have BOTH a browser surface (pages,
        // client components, layouts) AND a server surface (API routes,
        // server actions, route handlers, getServerSideProps, middleware).
        // We want analytics to fire correctly from both — the unified
        // browser SDK on the client, and @amplitude/analytics-node on the
        // server — so the agent must wire up both halves when the project
        // has them. Skipping server-side instrumentation is the most
        // common gap in Next.js setups.
        `Preferred BROWSER SDK: @amplitude/unified — wraps the browser SDK and bundles Session Replay + Guides & Surveys. Accepts the same config options as @amplitude/analytics-browser. Initialize from a 'use client' boundary (root layout for App Router, _app.tsx for Pages Router) so it loads in the browser bundle, never the server bundle.`,
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
