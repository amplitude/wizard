/* Vue wizard for Amplitude */
import type { FrameworkConfig } from '../../lib/framework-config';
import { detectNodePackageManagers } from '../../lib/package-manager-detection';
import { Integration } from '../../lib/constants';
import {
  getPackageVersion,
  hasPackageInstalled,
  type PackageDotJson,
} from '../../utils/package-json';
import { tryGetPackageJson } from '../../utils/setup-utils';
import { createVersionBucket } from '../../utils/semver';

const getVueVersionBucket = createVersionBucket();

type VueContext = Record<string, unknown>;

export const VUE_AGENT_CONFIG: FrameworkConfig<VueContext> = {
  metadata: {
    name: 'Vue',
    glyph: '🟢',
    glyphColor: '#42B883',
    integration: Integration.vue,
    targetsBrowser: true,
    docsUrl: 'https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2',
    beta: true,
  },

  detection: {
    packageName: 'vue',
    packageDisplayName: 'Vue',
    getVersion: (packageJson: unknown) =>
      getPackageVersion('vue', packageJson as PackageDotJson),
    getVersionBucket: getVueVersionBucket,
    getInstalledVersion: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      return packageJson ? getPackageVersion('vue', packageJson) : undefined;
    },
    detect: async (options) => {
      const packageJson = await tryGetPackageJson(options);
      if (!packageJson) return false;
      // Nuxt projects have both 'vue' and 'nuxt' — don't claim them
      if (hasPackageInstalled('nuxt', packageJson)) return false;
      return hasPackageInstalled('vue', packageJson);
    },
    detectPackageManager: detectNodePackageManagers,
  },

  environment: {
    uploadToHosting: true,
    getEnvVars: (apiKey: string, _host: string) => ({
      VITE_AMPLITUDE_API_KEY: apiKey,
    }),
  },

  analytics: {
    getTags: () => ({}),
  },

  prompts: {
    projectTypeDetection:
      'This is a JavaScript/TypeScript project. Look for package.json and lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) to confirm.',
    getAdditionalContextLines: () => {
      const frameworkId = 'vue';
      return [
        `Framework docs ID: ${frameworkId} (use amplitude://docs/frameworks/${frameworkId} for documentation)`,
        `Preferred Amplitude SDK: @amplitude/unified (prefer over @amplitude/analytics-browser for new browser integrations)`,
      ];
    },
  },

  ui: {
    successMessage: 'Amplitude integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: () => [
      'Analyzed your Vue project structure',
      'Created and configured Amplitude initializers',
      'Integrated Amplitude into your application',
    ],
    getOutroNextSteps: () => [
      'Start your development server to see Amplitude in action',
      'Visit your Amplitude dashboard to see incoming events',
    ],
  },
};
