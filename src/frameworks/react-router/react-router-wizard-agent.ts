/* React Router wizard for Amplitude */
import type { WizardOptions } from '../../utils/types';
import type { FrameworkConfig } from '../../lib/framework-config';
import { detectNodePackageManagers } from '../../lib/package-manager-detection';
import { Integration } from '../../lib/constants';
import {
  getPackageVersion,
  hasPackageInstalled,
  type PackageDotJson,
} from '../../utils/package-json';
import { tryGetPackageJson } from '../../utils/setup-utils';
import { getUI } from '../../ui';
import {
  getReactRouterMode,
  getReactRouterModeName,
  getReactRouterVersionBucket,
  ReactRouterMode,
} from './utils';

type ReactRouterContext = {
  routerMode?: ReactRouterMode;
};

export const REACT_ROUTER_AGENT_CONFIG: FrameworkConfig<ReactRouterContext> = {
  metadata: {
    name: 'React Router',
    integration: Integration.reactRouter,
    docsUrl: 'https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2',
    unsupportedVersionDocsUrl:
      'https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2',
    gatherContext: async (options: WizardOptions) => {
      const routerMode = await getReactRouterMode(options);
      if (routerMode) {
        getUI().setDetectedFramework(
          `React Router ${getReactRouterModeName(routerMode)}`,
        );
        return { routerMode };
      }
      return {};
    },
  },

  detection: {
    packageName: 'react-router',
    packageDisplayName: 'React Router',
    getVersion: (packageJson: unknown) =>
      getPackageVersion('react-router', packageJson as PackageDotJson),
    getVersionBucket: getReactRouterVersionBucket,
    minimumVersion: '6.0.0',
    getInstalledVersion: async (options: WizardOptions) => {
      const packageJson = await tryGetPackageJson(options);
      return packageJson
        ? getPackageVersion('react-router', packageJson)
        : undefined;
    },
    detect: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      return packageJson
        ? hasPackageInstalled('react-router', packageJson)
        : false;
    },
    detectPackageManager: detectNodePackageManagers,
  },

  environment: {
    uploadToHosting: false,
    getEnvVars: (apiKey: string, _host: string) => ({
      REACT_APP_AMPLITUDE_API_KEY: apiKey,
    }),
  },

  analytics: {
    getTags: (context) => ({
      routerMode: context.routerMode || 'unknown',
    }),
  },

  prompts: {
    projectTypeDetection:
      'This is a JavaScript/TypeScript project. Look for package.json and lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) to confirm.',
    getAdditionalContextLines: (context) => {
      const routerMode = context.routerMode;
      const modeName = routerMode
        ? getReactRouterModeName(routerMode)
        : 'unknown';

      // Map router mode to framework ID for MCP docs resource
      const frameworkIdMap: Record<ReactRouterMode, string> = {
        [ReactRouterMode.V6]: 'react-react-router-6',
        [ReactRouterMode.V7_FRAMEWORK]: 'react-react-router-7-framework',
        [ReactRouterMode.V7_DATA]: 'react-react-router-7-data',
        [ReactRouterMode.V7_DECLARATIVE]: 'react-react-router-7-declarative',
      };

      const frameworkId = routerMode
        ? frameworkIdMap[routerMode]
        : ReactRouterMode.V7_FRAMEWORK;

      return [
        `Router mode: ${modeName}`,
        `Framework docs ID: ${frameworkId} (use amplitude://docs/frameworks/${frameworkId} for documentation)`,
      ];
    },
  },

  ui: {
    successMessage: 'Amplitude integration complete',
    estimatedDurationMinutes: 8,
    getOutroChanges: (context) => {
      const modeName = context.routerMode
        ? getReactRouterModeName(context.routerMode)
        : 'React Router';
      return [
        `Analyzed your React Router project structure (${modeName})`,
        `Created and configured Amplitude initializers`,
        `Integrated Amplitude into your application`,
      ];
    },
    getOutroNextSteps: () => [
      'Start your development server to see Amplitude in action',
      'Visit your Amplitude dashboard to see incoming events',
    ],
  },
};
