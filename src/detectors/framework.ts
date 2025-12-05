/**
 * Framework detection utilities
 */
import {
  readPackageJson,
  hasPackageInstalled,
  directoryExists,
  fileExists,
} from '../utils/file.js';
import { Framework, PackageManager } from '../types/index.js';
import type { DetectedProject } from '../types/index.js';
import { detectFlask, detectFastAPI, detectDjango } from './python.js';
import path from 'path';

/**
 * Framework detection order - check more specific frameworks first
 */
export const FRAMEWORK_ORDER = [
  Framework.NEXTJS_APP,
  Framework.NEXTJS_PAGES,
  Framework.REACT_CRA,
  Framework.REACT_VITE,
  Framework.VUE,
  Framework.PYTHON_DJANGO,
  Framework.PYTHON_FASTAPI,
  Framework.PYTHON_FLASK,
] as const;

/**
 * Common subdirectories where Python projects might be located
 */
const PYTHON_SUBDIRS = ['backend', 'server', 'api', 'src'];

/**
 * Check if a file exists in the root or common Python subdirectories
 */
async function fileExistsInPythonDirs(
  installDir: string,
  filename: string,
): Promise<boolean> {
  // Check root first
  if (await fileExists(installDir, filename)) {
    return true;
  }

  // Check common subdirectories
  for (const subdir of PYTHON_SUBDIRS) {
    if (await directoryExists(installDir, subdir)) {
      const subdirPath = path.join(installDir, subdir);
      if (await fileExists(subdirPath, filename)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Find a file in the root or common Python subdirectories and return the full path
 */
async function findFileInPythonDirs(
  installDir: string,
  filename: string,
): Promise<string | null> {
  // Check root first
  if (await fileExists(installDir, filename)) {
    return filename;
  }

  // Check common subdirectories
  for (const subdir of PYTHON_SUBDIRS) {
    if (await directoryExists(installDir, subdir)) {
      const subdirPath = path.join(installDir, subdir);
      if (await fileExists(subdirPath, filename)) {
        return path.join(subdir, filename);
      }
    }
  }

  return null;
}

/**
 * Detect the package manager being used
 */
export async function detectPackageManager(
  installDir: string,
): Promise<PackageManager> {
  // Check for Python package managers first (root or subdirectories)
  if (await fileExistsInPythonDirs(installDir, 'poetry.lock')) {
    return PackageManager.POETRY;
  }
  if (await fileExistsInPythonDirs(installDir, 'Pipfile.lock')) {
    return PackageManager.PIPENV;
  }
  if (await fileExistsInPythonDirs(installDir, 'requirements.txt')) {
    return PackageManager.PIP;
  }

  // Check for JavaScript package managers
  if (await fileExists(installDir, 'pnpm-lock.yaml')) {
    return PackageManager.PNPM;
  }
  if (await fileExists(installDir, 'yarn.lock')) {
    return PackageManager.YARN;
  }
  if (await fileExists(installDir, 'package.json')) {
    return PackageManager.NPM;
  }

  // Default to npm
  return PackageManager.NPM;
}

/**
 * Detect if the project uses TypeScript
 */
export async function detectTypeScript(installDir: string): Promise<boolean> {
  try {
    const packageJson = await readPackageJson(installDir);
    return (
      hasPackageInstalled('typescript', packageJson) ||
      (await fileExists(installDir, 'tsconfig.json'))
    );
  } catch {
    return false;
  }
}

/**
 * Detect Next.js framework and router type
 */
async function detectNextJs(installDir: string): Promise<Framework | null> {
  try {
    const packageJson = await readPackageJson(installDir);
    if (!hasPackageInstalled('next', packageJson)) {
      return null;
    }

    // Check for App Router (app directory)
    const hasAppRouter = await directoryExists(installDir, 'app');
    if (hasAppRouter) {
      return Framework.NEXTJS_APP;
    }

    // Check for Pages Router (pages directory)
    const hasPagesRouter = await directoryExists(installDir, 'pages');
    if (hasPagesRouter) {
      return Framework.NEXTJS_PAGES;
    }

    // Default to App Router if neither exists (new project setup)
    return Framework.NEXTJS_APP;
  } catch {
    return null;
  }
}

/**
 * Detect React with Vite
 */
async function detectReactVite(installDir: string): Promise<boolean> {
  try {
    const packageJson = await readPackageJson(installDir);
    return (
      hasPackageInstalled('react', packageJson) &&
      hasPackageInstalled('vite', packageJson)
    );
  } catch {
    return false;
  }
}

/**
 * Detect Create React App
 */
async function detectReactCRA(installDir: string): Promise<boolean> {
  try {
    const packageJson = await readPackageJson(installDir);
    return (
      hasPackageInstalled('react', packageJson) &&
      hasPackageInstalled('react-scripts', packageJson)
    );
  } catch {
    return false;
  }
}

/**
 * Detect Vue
 */
async function detectVue(installDir: string): Promise<boolean> {
  try {
    const packageJson = await readPackageJson(installDir);
    return hasPackageInstalled('vue', packageJson);
  } catch {
    return false;
  }
}

/**
 * Detect the framework being used
 */
export async function detectFramework(installDir: string): Promise<Framework> {
  // Check frameworks in priority order (most specific to least specific)
  for (const framework of FRAMEWORK_ORDER) {
    let detected = false;

    switch (framework) {
      case Framework.NEXTJS_APP:
      case Framework.NEXTJS_PAGES: {
        const nextJsFramework = await detectNextJs(installDir);
        if (nextJsFramework === framework) {
          return framework;
        }
        break;
      }

      case Framework.REACT_CRA:
        detected = await detectReactCRA(installDir);
        break;

      case Framework.REACT_VITE:
        detected = await detectReactVite(installDir);
        break;

      case Framework.VUE:
        detected = await detectVue(installDir);
        break;

      case Framework.PYTHON_DJANGO:
        detected = await detectDjango(installDir);
        break;

      case Framework.PYTHON_FASTAPI:
        detected = await detectFastAPI(installDir);
        break;

      case Framework.PYTHON_FLASK:
        detected = await detectFlask(installDir);
        break;
    }

    if (detected) {
      return framework;
    }
  }

  return Framework.UNKNOWN;
}

/**
 * Find the entry point file for the detected framework
 */
export async function findEntryPoint(
  installDir: string,
  framework: Framework,
): Promise<string> {
  const possibleEntryPoints: Record<Framework, string[]> = {
    [Framework.REACT_VITE]: [
      'src/main.tsx',
      'src/main.ts',
      'src/main.jsx',
      'src/main.js',
      'src/index.tsx',
      'src/index.ts',
    ],
    [Framework.REACT_CRA]: [
      'src/index.tsx',
      'src/index.ts',
      'src/index.jsx',
      'src/index.js',
    ],
    [Framework.NEXTJS_APP]: ['app/layout.tsx', 'app/layout.ts', 'app/layout.jsx', 'app/layout.js'],
    [Framework.NEXTJS_PAGES]: [
      'pages/_app.tsx',
      'pages/_app.ts',
      'pages/_app.jsx',
      'pages/_app.js',
    ],
    [Framework.VUE]: ['src/main.ts', 'src/main.js'],
    [Framework.PYTHON_FLASK]: [
      'app.py',
      'main.py',
      'server.py',
      'application.py',
      'wsgi.py',
    ],
    [Framework.PYTHON_FASTAPI]: ['main.py', 'app.py', 'server.py'],
    [Framework.PYTHON_DJANGO]: ['manage.py'],
    [Framework.UNKNOWN]: [],
  };

  const candidates = possibleEntryPoints[framework] || [];

  // For Python frameworks, search in subdirectories as well
  const isPythonFramework =
    framework === Framework.PYTHON_FLASK ||
    framework === Framework.PYTHON_FASTAPI ||
    framework === Framework.PYTHON_DJANGO;

  if (isPythonFramework) {
    for (const candidate of candidates) {
      const foundPath = await findFileInPythonDirs(installDir, candidate);
      if (foundPath) {
        return foundPath;
      }
    }
  } else {
    // For JS frameworks, check as before
    for (const candidate of candidates) {
      if (await fileExists(installDir, candidate)) {
        return candidate;
      }
    }
  }

  // Fallback: return first candidate even if it doesn't exist (will be created)
  return candidates[0] || 'src/main.tsx';
}

/**
 * Determine the environment variable prefix for the framework
 */
export function getEnvVarPrefix(framework: Framework): string {
  switch (framework) {
    case Framework.REACT_VITE:
      return 'VITE_';
    case Framework.REACT_CRA:
      return 'REACT_APP_';
    case Framework.NEXTJS_APP:
    case Framework.NEXTJS_PAGES:
      return 'NEXT_PUBLIC_';
    case Framework.VUE:
      return 'VITE_';
    default:
      return '';
  }
}

/**
 * Detect the complete project configuration
 */
export async function detectProject(installDir: string): Promise<DetectedProject> {
  const framework = await detectFramework(installDir);
  const packageManager = await detectPackageManager(installDir);
  const hasTypeScript = await detectTypeScript(installDir);
  const entryPoint = await findEntryPoint(installDir, framework);
  const envVarPrefix = getEnvVarPrefix(framework);

  return {
    framework,
    packageManager,
    entryPoint,
    hasTypeScript,
    envVarPrefix,
  };
}
