/* Generic JavaScript Web (client-side) wizard for Amplitude */
import type { WizardOptions } from '../../utils/types';
import type { FrameworkConfig } from '../../lib/framework-config';
import { Integration } from '../../lib/constants';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tryGetPackageJson } from '../../utils/package-json-light';
import {
  detectJsPackageManager,
  detectBundler,
  hasIndexHtml,
  type JavaScriptContext,
} from './utils';
import { detectNodePackageManagersLight as detectNodePackageManagers } from '../../lib/package-manager-detection-light';
import { BROWSER_UNIFIED_SDK_PROMPT_LINE } from '../_shared/browser-sdk-prompt';
import { javascriptWebBlockedByFrameworkPackage } from '../_shared/javascript-web-blocking-policy';

export const JAVASCRIPT_WEB_AGENT_CONFIG: FrameworkConfig<JavaScriptContext> = {
  metadata: {
    name: 'JavaScript (Web)',
    glyph: '🌐',
    glyphColor: '#F7DF1E',
    integration: Integration.javascript_web,
    targetsBrowser: true,
    beta: true,
    docsUrl: 'https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2',
    gatherContext: async (options: WizardOptions) => {
      const packageManagerName = await detectJsPackageManager(options);
      const hasTypeScript = fs.existsSync(
        path.join(options.installDir, 'tsconfig.json'),
      );
      const hasBundler = detectBundler(options);
      return { packageManagerName, hasTypeScript, hasBundler };
    },
  },

  detection: {
    packageName: '@amplitude/analytics-browser',
    packageDisplayName: 'JavaScript (Web)',
    usesPackageJson: false,
    getVersion: () => undefined,
    detectPackageManager: detectNodePackageManagers,
    detect: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      if (!packageJson) {
        return false;
      }

      // A "bin" field means this is a Node.js CLI tool, not a web app
      if (packageJson.bin) {
        return false;
      }

      if (javascriptWebBlockedByFrameworkPackage(packageJson)) {
        return false;
      }

      const { installDir } = options;

      // Has (index.html OR has a bundler) AND is a JavaScript project
      const hasIndexHtmlFlag = hasIndexHtml(options);

      const bundler = detectBundler(options);
      const hasBundler = !!bundler;

      const hasLockfile = [
        'package-lock.json',
        'yarn.lock',
        'pnpm-lock.yaml',
        'bun.lockb',
        'bun.lock',
        'deno.lock',
      ].some((lockfile) => fs.existsSync(path.join(installDir, lockfile)));

      // We only treat this as JS Web if there's BOTH:
      // - a lockfile, and
      // - at least one frontend signal (index.html or bundler)
      if (hasLockfile && (hasIndexHtmlFlag || hasBundler)) {
        return true;
      }

      // Otherwise → Node/Backend (handled by javascriptNode fallback)
      return false;
    },
  },

  environment: {
    uploadToHosting: false,
    getEnvVars: (apiKey: string, _host: string) => ({
      AMPLITUDE_API_KEY: apiKey,
    }),
  },

  analytics: {
    getTags: (context) => {
      const tags: Record<string, string> = {
        packageManager: context.packageManagerName ?? 'unknown',
      };
      if (context.hasBundler) {
        tags.bundler = context.hasBundler;
      }
      return tags;
    },
  },

  prompts: {
    projectTypeDetection:
      'This is a JavaScript/TypeScript project. Look for package.json and lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) to confirm.',
    packageInstallation:
      'Look for lockfiles to determine the package manager (npm, yarn, pnpm, bun). Do not manually edit package.json.',
    getAdditionalContextLines: (context) => {
      const lines = [
        `Package manager: ${context.packageManagerName ?? 'unknown'}`,
        `Has TypeScript: ${context.hasTypeScript ? 'yes' : 'no'}`,
        `Framework docs ID: js (use amplitude://docs/frameworks/js for documentation if available)`,
        `Project type: Generic JavaScript/TypeScript application (no specific framework detected)`,
        BROWSER_UNIFIED_SDK_PROMPT_LINE,
        `Initialize from the project's main entry point (e.g. src/main.ts, src/index.ts, or wherever the app boots) before any tracked user code runs. For static-HTML / no-bundler projects, the CDN <script> tag flow is appropriate instead — but the npm path is preferred whenever a build pipeline exists.`,
      ];

      if (context.hasBundler) {
        lines.unshift(`Bundler: ${context.hasBundler}`);
      }

      return lines;
    },
  },

  ui: {
    successMessage: 'Amplitude integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: (context) => {
      const packageManagerName =
        context.packageManagerName ?? 'package manager';
      return [
        `Analyzed your JavaScript project structure`,
        `Installed the @amplitude/unified package using ${packageManagerName}`,
        `Created Amplitude initialization code`,
        `Configured autocapture and event tracking`,
      ];
    },
    getOutroNextSteps: () => [
      'Ensure amplitude.init() is called before any track calls',
      'Autocapture tracks clicks, form submissions, and pageviews automatically',
      'Use amplitude.track() for custom events and amplitude.setUserId() for users',
      'NEVER send PII in event properties (no emails, names, or user content)',
      'Visit your Amplitude dashboard to see incoming events',
    ],
  },
};
