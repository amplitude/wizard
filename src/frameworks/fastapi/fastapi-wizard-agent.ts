/* FastAPI wizard for Amplitude */
import type { WizardOptions } from '../../utils/types';
import type { FrameworkConfig } from '../../lib/framework-config';
import { PYTHON_PACKAGE_INSTALLATION } from '../../lib/framework-config';
import { detectPythonPackageManagers } from '../../lib/package-manager-detection';
import { Integration } from '../../lib/constants';
import {
  getFastAPIVersion,
  getFastAPIProjectType,
  getFastAPIProjectTypeName,
  getFastAPIVersionBucket,
  FastAPIProjectType,
  findFastAPIAppFile,
} from './utils';

interface FastAPIContext extends Record<string, unknown> {
  projectType?: FastAPIProjectType;
  appFile?: string;
}
import fg from 'fast-glob';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * FastAPI framework configuration for the universal agent runner
 */

export const FASTAPI_AGENT_CONFIG: FrameworkConfig<FastAPIContext> = {
  metadata: {
    name: 'FastAPI',
    glyph: '⚡',
    glyphColor: '#009688',
    integration: Integration.fastapi,
    autocaptureEnabled: false,
    docsUrl: 'https://amplitude.com/docs/sdks/analytics/python',
    unsupportedVersionDocsUrl:
      'https://amplitude.com/docs/sdks/analytics/python',
    gatherContext: async (options: WizardOptions) => {
      const projectType = await getFastAPIProjectType(options);
      const appFile = await findFastAPIAppFile(options);
      return { projectType, appFile };
    },
  },

  detection: {
    packageName: 'fastapi',
    packageDisplayName: 'FastAPI',
    usesPackageJson: false,
    getVersion: (_packageJson: unknown) => {
      // For FastAPI, we don't use package.json. Version is extracted separately
      // from requirements.txt or pyproject.toml in the wizard entry point
      return undefined;
    },
    getVersionBucket: getFastAPIVersionBucket,
    getInstalledVersion: getFastAPIVersion,
    detect: async (options) => {
      const { installDir } = options;

      // Note: Django and Flask are checked before FastAPI in INTEGRATION_ORDER,
      // so if we get here, the project is not a Django or Flask project.

      // Check for FastAPI in requirements files
      const requirementsFiles = await fg(
        [
          '**/requirements*.txt',
          '**/pyproject.toml',
          '**/setup.py',
          '**/Pipfile',
        ],
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
          // Check for fastapi package (case-insensitive)
          // Match "fastapi" as a standalone package
          if (
            /^fastapi([<>=~!]|$|\s)/im.test(content) ||
            /["']fastapi["']/i.test(content)
          ) {
            return true;
          }
        } catch {
          continue;
        }
      }

      // Check for FastAPI app patterns in Python files
      const pyFiles = await fg(
        ['**/main.py', '**/app.py', '**/application.py', '**/__init__.py'],
        {
          cwd: installDir,
          ignore: [
            '**/venv/**',
            '**/.venv/**',
            '**/env/**',
            '**/.env/**',
            '**/__pycache__/**',
          ],
        },
      );

      for (const pyFile of pyFiles) {
        try {
          const content = fs.readFileSync(
            path.join(installDir, pyFile),
            'utf-8',
          );
          if (
            content.includes('from fastapi import') ||
            content.includes('import fastapi') ||
            /FastAPI\s*\(/.test(content)
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
    getTags: (context: FastAPIContext) => {
      const projectType = context.projectType;
      return {
        projectType: projectType || 'unknown',
      };
    },
  },

  prompts: {
    packageInstallation: PYTHON_PACKAGE_INSTALLATION,
    projectTypeDetection:
      'This is a Python/FastAPI project. Look for requirements.txt, pyproject.toml, setup.py, Pipfile, or main.py/app.py to confirm.',
    getAdditionalContextLines: (context: FastAPIContext) => {
      const projectType = context.projectType;
      const projectTypeName = projectType
        ? getFastAPIProjectTypeName(projectType)
        : 'unknown';

      // Map project type to framework ID for MCP docs resource
      const frameworkIdMap: Record<FastAPIProjectType, string> = {
        [FastAPIProjectType.STANDARD]: 'fastapi',
        [FastAPIProjectType.ROUTER]: 'fastapi',
        [FastAPIProjectType.FULLSTACK]: 'fastapi',
      };

      const frameworkId = projectType ? frameworkIdMap[projectType] : 'fastapi';

      const lines = [
        `Project type: ${projectTypeName}`,
        `Framework docs ID: ${frameworkId} (use amplitude://docs/frameworks/${frameworkId} for documentation)`,
      ];

      if (context.appFile) {
        lines.push(`App file: ${String(context.appFile)}`);
      }

      return lines;
    },
  },

  ui: {
    successMessage: 'Amplitude integration complete',
    estimatedDurationMinutes: 5,
    getOutroChanges: (context: FastAPIContext) => {
      const projectType = context.projectType;
      const projectTypeName = projectType
        ? getFastAPIProjectTypeName(projectType)
        : 'FastAPI';
      return [
        `Analyzed your ${projectTypeName} project structure`,
        `Installed the Amplitude Python package`,
        `Configured Amplitude in your FastAPI application`,
        `Added Amplitude initialization with lifespan event handling`,
      ];
    },
    getOutroNextSteps: () => [
      'Start your FastAPI development server to see Amplitude in action',
      'Visit your Amplitude dashboard to see incoming events',
      'Use amplitude.identify() to associate events with users',
    ],
  },
};
