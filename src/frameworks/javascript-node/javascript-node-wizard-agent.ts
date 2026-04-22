/* Generic Node.js language wizard using Amplitude */
import type { FrameworkConfig } from '../../lib/framework-config';
import { Integration } from '../../lib/constants';
import { hasPackageInstalled } from '../../utils/package-json';
import { tryGetPackageJson } from '../../utils/setup-utils';
import { detectNodePackageManagers } from '../../lib/package-manager-detection';
import { FRAMEWORK_PACKAGES } from '../javascript-web/utils';

type JavaScriptNodeContext = Record<string, unknown>;

export const JAVASCRIPT_NODE_AGENT_CONFIG: FrameworkConfig<JavaScriptNodeContext> =
  {
    metadata: {
      name: 'Node.js',
      glyph: '●',
      glyphColor: '#5FA04E',
      integration: Integration.javascriptNode,
      beta: true,
      docsUrl:
        'https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2',
    },

    detection: {
      packageName: '@amplitude/analytics-node',
      packageDisplayName: 'Node.js',
      usesPackageJson: false,
      getVersion: () => undefined,
      detectPackageManager: detectNodePackageManagers,
      detect: async (options) => {
        const packageJson = await tryGetPackageJson(options);
        if (!packageJson) return false;
        // Don't claim projects that belong to a specific framework
        for (const frameworkPkg of FRAMEWORK_PACKAGES) {
          if (hasPackageInstalled(frameworkPkg, packageJson)) {
            return false;
          }
        }
        return true;
      },
    },

    environment: {
      uploadToHosting: false,
      getEnvVars: (apiKey: string, _host: string) => ({
        AMPLITUDE_API_KEY: apiKey,
      }),
    },

    analytics: {
      getTags: () => ({}),
    },

    prompts: {
      projectTypeDetection:
        'This is a server-side Node.js project. Look for package.json and lockfiles to confirm.',
      packageInstallation:
        'Use npm, yarn, pnpm, or bun based on the existing lockfile (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb). Install @amplitude/analytics-node as a regular dependency.',
      getAdditionalContextLines: () => [
        `Framework docs ID: javascript_node (use amplitude://docs/frameworks/javascript_node for documentation)`,
      ],
    },

    ui: {
      successMessage: 'Amplitude integration complete',
      estimatedDurationMinutes: 5,
      getOutroChanges: () => [
        `Analyzed your Node.js project structure`,
        `Installed the @amplitude/analytics-node package`,
        `Created Amplitude initialization with proper configuration`,
        `Added example code for events and user identification`,
      ],
      getOutroNextSteps: () => [
        'Use the Amplitude client instance for all tracking calls',
        'NEVER send PII in event properties (no emails, names, or user content)',
        'Use amplitude.track() for events and amplitude.identify() for users',
        'Visit your Amplitude dashboard to see incoming events',
      ],
    },
  };
