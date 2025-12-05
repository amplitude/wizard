/**
 * Core types for the Amplitude Wizard
 */

export enum Framework {
  REACT_VITE = 'react-vite',
  REACT_CRA = 'react-cra',
  NEXTJS_APP = 'nextjs-app',
  NEXTJS_PAGES = 'nextjs-pages',
  VUE = 'vue',
  PYTHON_FLASK = 'python-flask',
  PYTHON_DJANGO = 'python-django',
  PYTHON_FASTAPI = 'python-fastapi',
  UNKNOWN = 'unknown',
}

export enum PackageManager {
  NPM = 'npm',
  YARN = 'yarn',
  PNPM = 'pnpm',
  PIP = 'pip',
  POETRY = 'poetry',
  PIPENV = 'pipenv',
}

export interface WizardOptions {
  installDir: string;
  apiKey?: string;
  deploymentKey?: string;
  framework?: Framework;
  debug?: boolean;
  default?: boolean; // Non-interactive mode for AI agents
  dryRun?: boolean;
  anthropicApiKey?: string;
}

export interface FileChange {
  filePath: string;
  oldContent: string | undefined;
  newContent: string;
}

export interface DetectedProject {
  framework: Framework;
  packageManager: PackageManager;
  entryPoint: string;
  hasTypeScript: boolean;
  envVarPrefix: string; // e.g., 'VITE_', 'NEXT_PUBLIC_', 'REACT_APP_'
}

export interface FrameworkConfig {
  name: string;
  filterPatterns: string[];
  ignorePatterns: string[];
  detect: (installDir: string) => Promise<boolean>;
  getDocumentation: (project: DetectedProject) => string;
  filterFilesRules: string;
  generateFilesRules: string;
  nextSteps: string;
}
