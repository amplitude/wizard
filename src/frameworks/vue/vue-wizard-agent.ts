/* Vue wizard for Amplitude */
import fg from 'fast-glob';
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

const FILE_SCAN_IGNORES = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/.nuxt/**',
  '**/.output/**',
];

/**
 * Fallback Vue detection: sniff for .vue source files or Vite config when
 * package.json is missing or doesn't list `vue` (e.g. unusual scaffolds,
 * partial checkouts). Returns false if the tree looks Nuxt-shaped.
 */
async function hasVueFileSignals(installDir: string): Promise<boolean> {
  const nuxtConfigs = await fg(['nuxt.config.{ts,js,mjs,cjs}'], {
    cwd: installDir,
    deep: 2,
    ignore: FILE_SCAN_IGNORES,
  });
  if (nuxtConfigs.length > 0) return false;

  const vueFiles = await fg(['**/*.vue'], {
    cwd: installDir,
    deep: 4,
    ignore: FILE_SCAN_IGNORES,
  });
  return vueFiles.length > 0;
}

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
    getIntegrationSkillId: () => 'integration-vue-3',
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
      if (packageJson) {
        // Nuxt projects have both 'vue' and 'nuxt' — don't claim them
        if (hasPackageInstalled('nuxt', packageJson)) return false;
        return hasPackageInstalled('vue', packageJson);
      }
      // Fallback: sniff for .vue source files ONLY when package.json is
      // missing. If the manifest exists, trust it — avoids walking large
      // node_modules trees on every non-Vue project.
      return hasVueFileSignals(options.installDir);
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
