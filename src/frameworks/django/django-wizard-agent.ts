/* Django wizard for Amplitude */
import type { WizardOptions } from '../../utils/types';
import type { FrameworkConfig } from '../../lib/framework-config';
import { PYTHON_PACKAGE_INSTALLATION } from '../../lib/framework-config';
import { detectPythonPackageManagers } from '../../lib/package-manager-detection';
import { Integration } from '../../lib/constants';
import fg from 'fast-glob';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  getDjangoVersion,
  getDjangoProjectType,
  getDjangoProjectTypeName,
  getDjangoVersionBucket,
  DjangoProjectType,
  findDjangoSettingsFile,
} from './utils';

type DjangoContext = {
  projectType?: DjangoProjectType;
  settingsFile?: string;
};

export const DJANGO_AGENT_CONFIG: FrameworkConfig<DjangoContext> = {
  metadata: {
    name: 'Django',
    glyph: '🎸',
    glyphColor: '#44B78B',
    integration: Integration.django,
    autocaptureEnabled: false,
    beta: true,
    docsUrl: 'https://amplitude.com/docs/sdks/analytics/python',
    unsupportedVersionDocsUrl:
      'https://amplitude.com/docs/sdks/analytics/python',
    gatherContext: async (options: WizardOptions) => {
      const projectType = await getDjangoProjectType(options);
      const settingsFile = await findDjangoSettingsFile(options);
      return { projectType, settingsFile };
    },
  },

  detection: {
    packageName: 'django',
    packageDisplayName: 'Django',
    usesPackageJson: false,
    getVersion: () => undefined,
    getVersionBucket: getDjangoVersionBucket,
    minimumVersion: '3.0.0',
    getInstalledVersion: (options: WizardOptions) => getDjangoVersion(options),
    detect: async (options) => {
      const { installDir } = options;

      const managePyMatches = await fg('**/manage.py', {
        cwd: installDir,
        ignore: ['**/venv/**', '**/.venv/**', '**/env/**', '**/.env/**'],
      });

      if (managePyMatches.length > 0) {
        for (const match of managePyMatches) {
          try {
            const content = fs.readFileSync(
              path.join(installDir, match),
              'utf-8',
            );
            // Check for actual Django imports and usage
            if (
              content.includes('from django') ||
              content.includes('import django') ||
              content.includes('DJANGO_SETTINGS_MODULE') ||
              /execute_from_command_line/.test(content)
            ) {
              return true;
            }
          } catch {
            continue;
          }
        }
      }

      const requirementsFiles = await fg(
        ['**/requirements*.txt', '**/pyproject.toml', '**/setup.py'],
        {
          cwd: installDir,
          ignore: ['**/venv/**', '**/.venv/**', '**/env/**', '**/.env/**'],
        },
      );

      for (const reqFile of requirementsFiles) {
        try {
          const content = fs.readFileSync(
            path.join(installDir, reqFile),
            'utf-8',
          );
          // Match Django as a package requirement, not in comments or other text
          // Look for: django, django>=, django==, django~=, Django (capitalized)
          if (
            /^django([>=~!<\s]|$)/im.test(content) ||
            /["']django["']/i.test(content)
          ) {
            return true;
          }
        } catch {
          continue;
        }
      }

      return false;
    },
    detectPackageManager: detectPythonPackageManagers,
  },

  environment: {
    uploadToHosting: false,
    getEnvVars: (apiKey: string, _host: string) => ({
      AMPLITUDE_API_KEY: apiKey,
    }),
  },

  analytics: {
    getTags: (context) => ({
      projectType: context.projectType || 'unknown',
    }),
  },

  prompts: {
    packageInstallation: PYTHON_PACKAGE_INSTALLATION,
    projectTypeDetection:
      'This is a Python/Django project. Look for requirements.txt, pyproject.toml, setup.py, Pipfile, or manage.py to confirm.',
    getAdditionalContextLines: (context) => {
      const projectTypeName = context.projectType
        ? getDjangoProjectTypeName(context.projectType)
        : 'unknown';

      // Map project type to framework ID for MCP docs resource
      const frameworkIdMap: Record<DjangoProjectType, string> = {
        [DjangoProjectType.STANDARD]: 'django',
        [DjangoProjectType.DRF]: 'django',
        [DjangoProjectType.WAGTAIL]: 'django',
        [DjangoProjectType.CHANNELS]: 'django',
      };

      const frameworkId = context.projectType
        ? frameworkIdMap[context.projectType]
        : 'django';

      const lines = [
        `Project type: ${projectTypeName}`,
        `Framework docs ID: ${frameworkId} (use amplitude://docs/frameworks/${frameworkId} for documentation)`,
      ];

      if (context.settingsFile) {
        lines.push(`Settings file: ${context.settingsFile}`);
      }

      return lines;
    },
  },

  ui: {
    successMessage: 'Amplitude integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: (context) => {
      const projectTypeName = context.projectType
        ? getDjangoProjectTypeName(context.projectType)
        : 'Django';
      return [
        `Analyzed your ${projectTypeName} project structure`,
        `Installed the Amplitude Python package`,
        `Configured Amplitude in your Django settings`,
        `Added Amplitude middleware for event tracking`,
      ];
    },
    getOutroNextSteps: () => [
      'Start your Django development server to see Amplitude in action',
      'Visit your Amplitude dashboard to see incoming events',
      'Use amplitude.track() to capture events and amplitude.identify() for users',
    ],
  },
};
