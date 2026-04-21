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

const REACT_ROUTER_MINIMUM_VERSION = '6.0.0';
const TANSTACK_MINIMUM_VERSION = '1.0.0';

// Priority matches gatherContext: TanStack Start > TanStack Router > react-router
function getReactRouterVersionCheckInfo(packageJson: PackageDotJson): {
  version?: string;
  minimumVersion?: string;
  packageDisplayName?: string;
} {
  const tanstackStartVersion = getPackageVersion(
    '@tanstack/react-start',
    packageJson,
  );
  if (tanstackStartVersion) {
    return {
      version: tanstackStartVersion,
      minimumVersion: TANSTACK_MINIMUM_VERSION,
      packageDisplayName: 'TanStack Start',
    };
  }

  const tanstackRouterVersion = getPackageVersion(
    '@tanstack/react-router',
    packageJson,
  );
  if (tanstackRouterVersion) {
    return {
      version: tanstackRouterVersion,
      minimumVersion: TANSTACK_MINIMUM_VERSION,
      packageDisplayName: 'TanStack Router',
    };
  }

  const reactRouterVersion = getPackageVersion('react-router', packageJson);
  if (reactRouterVersion) {
    return {
      version: reactRouterVersion,
      minimumVersion: REACT_ROUTER_MINIMUM_VERSION,
      packageDisplayName: 'React Router',
    };
  }

  return {};
}

export const REACT_ROUTER_AGENT_CONFIG: FrameworkConfig<ReactRouterContext> = {
  metadata: {
    name: 'React Router',
    integration: Integration.reactRouter,
    autocaptureEnabled: true,
    docsUrl: 'https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2',
    unsupportedVersionDocsUrl:
      'https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2',
    gatherContext: async (options: WizardOptions) => {
      const packageJson = await tryGetPackageJson(options);

      // TanStack Start / TanStack Router share the same browser SDK setup
      if (
        packageJson &&
        hasPackageInstalled('@tanstack/react-start', packageJson)
      ) {
        getUI().setDetectedFramework('TanStack Start');
        return { routerMode: ReactRouterMode.V7_FRAMEWORK };
      }
      if (
        packageJson &&
        hasPackageInstalled('@tanstack/react-router', packageJson)
      ) {
        getUI().setDetectedFramework('TanStack Router');
        return {};
      }

      // Standard React Router detection
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
    getVersion: (packageJson: unknown) => {
      const pkg = packageJson as PackageDotJson;
      // Priority matches gatherContext: TanStack Start > TanStack Router > react-router
      return (
        getPackageVersion('@tanstack/react-start', pkg) ??
        getPackageVersion('@tanstack/react-router', pkg) ??
        getPackageVersion('react-router', pkg)
      );
    },
    getVersionBucket: getReactRouterVersionBucket,
    minimumVersion: REACT_ROUTER_MINIMUM_VERSION,
    getInstalledVersion: async (options: WizardOptions) => {
      const packageJson = await tryGetPackageJson(options);
      if (!packageJson) return undefined;
      return getReactRouterVersionCheckInfo(packageJson).version;
    },
    getVersionCheckInfo: async (options: WizardOptions) => {
      const packageJson = await tryGetPackageJson(options);
      if (!packageJson) return {};
      return getReactRouterVersionCheckInfo(packageJson);
    },
    detect: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      if (!packageJson) return false;
      return (
        hasPackageInstalled('react-router', packageJson) ||
        hasPackageInstalled('@tanstack/react-router', packageJson) ||
        hasPackageInstalled('@tanstack/react-start', packageJson)
      );
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
        `Preferred Amplitude SDK: @amplitude/unified (prefer over @amplitude/analytics-browser for new browser integrations)`,
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
