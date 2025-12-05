/**
 * File system utilities for reading and modifying project files
 */
import fs from 'fs/promises';
import path from 'path';
import fg from 'fast-glob';
import type { FileChange, WizardOptions } from '../types/index.js';

// Directories to always ignore when scanning projects
const GLOBAL_IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/public/**',
  '**/static/**',
  '**/.git/**',
  '**/coverage/**',
  '**/.cache/**',
  '**/tmp/**',
  '**/temp/**',
];

/**
 * Read package.json from the install directory
 */
export async function readPackageJson(installDir: string): Promise<any> {
  try {
    const packageJsonPath = path.join(installDir, 'package.json');
    const content = await fs.readFile(packageJsonPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to read package.json: ${error}`);
  }
}

/**
 * Check if a package is installed
 */
export function hasPackageInstalled(
  packageName: string,
  packageJson: any,
): boolean {
  const deps = packageJson.dependencies || {};
  const devDeps = packageJson.devDependencies || {};
  return packageName in deps || packageName in devDeps;
}

/**
 * Get all files in a project matching specific patterns
 */
export async function getFilesMatchingPatterns(
  installDir: string,
  patterns: string[],
  ignorePatterns: string[] = [],
): Promise<string[]> {
  const allIgnorePatterns = [...GLOBAL_IGNORE_PATTERNS, ...ignorePatterns];

  const files = await fg(patterns, {
    cwd: installDir,
    ignore: allIgnorePatterns,
    onlyFiles: true,
  });

  return files;
}

/**
 * Get all files in the project (for LLM file filtering)
 */
export async function getAllFilesInProject(installDir: string): Promise<string[]> {
  return getFilesMatchingPatterns(installDir, ['**/*']);
}

/**
 * Read a file's contents
 */
export async function readFile(
  installDir: string,
  filePath: string,
): Promise<string> {
  const fullPath = path.join(installDir, filePath);
  return fs.readFile(fullPath, 'utf8');
}

/**
 * Write a file's contents (creates directories if needed)
 */
export async function writeFile(
  installDir: string,
  filePath: string,
  content: string,
): Promise<void> {
  const fullPath = path.join(installDir, filePath);
  const dir = path.dirname(fullPath);

  // Create parent directories if they don't exist
  await fs.mkdir(dir, { recursive: true });

  // Write the file
  await fs.writeFile(fullPath, content, 'utf8');
}

/**
 * Check if a file exists
 */
export async function fileExists(
  installDir: string,
  filePath: string,
): Promise<boolean> {
  try {
    const fullPath = path.join(installDir, filePath);
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a directory exists
 */
export async function directoryExists(
  installDir: string,
  dirPath: string,
): Promise<boolean> {
  try {
    const fullPath = path.join(installDir, dirPath);
    const stats = await fs.stat(fullPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Apply a file change (create or update a file)
 */
export async function applyFileChange(
  change: FileChange,
  options: Pick<WizardOptions, 'installDir' | 'dryRun'>,
): Promise<void> {
  if (options.dryRun) {
    console.log(`[DRY RUN] Would write: ${change.filePath}`);
    return;
  }

  await writeFile(options.installDir, change.filePath, change.newContent);
}

/**
 * Update or create .env.local file with Amplitude keys
 */
export async function updateEnvFile(
  installDir: string,
  apiKey: string,
  deploymentKey?: string,
  envVarPrefix = '',
): Promise<void> {
  const envPath = path.join(installDir, '.env.local');
  let existingContent = '';

  // Read existing .env.local if it exists
  try {
    existingContent = await fs.readFile(envPath, 'utf8');
  } catch {
    // File doesn't exist, that's fine
  }

  const apiKeyVar = `${envVarPrefix}AMPLITUDE_API_KEY`;
  const deploymentKeyVar = `${envVarPrefix}AMPLITUDE_DEPLOYMENT_KEY`;

  // Check if variables already exist (including placeholders)
  const apiKeyPattern = new RegExp(`^${apiKeyVar}=.*$`, 'm');
  const deploymentKeyPattern = new RegExp(`^${deploymentKeyVar}=.*$`, 'm');

  // Replace existing values or add new ones
  if (apiKeyPattern.test(existingContent)) {
    // Replace existing API key
    existingContent = existingContent.replace(
      apiKeyPattern,
      `${apiKeyVar}=${apiKey}`,
    );
  } else {
    // Add new API key
    if (existingContent && !existingContent.endsWith('\n')) {
      existingContent += '\n';
    }
    if (!existingContent.includes('# Amplitude SDK Configuration')) {
      existingContent += '\n# Amplitude SDK Configuration\n';
    }
    existingContent += `${apiKeyVar}=${apiKey}\n`;
  }

  // Handle deployment key
  if (deploymentKey) {
    if (deploymentKeyPattern.test(existingContent)) {
      // Replace existing deployment key
      existingContent = existingContent.replace(
        deploymentKeyPattern,
        `${deploymentKeyVar}=${deploymentKey}`,
      );
    } else {
      // Add new deployment key
      existingContent += `${deploymentKeyVar}=${deploymentKey}\n`;
    }
  }

  await fs.writeFile(envPath, existingContent, 'utf8');
}

/**
 * Update .gitignore to include .env.local if not already present
 */
export async function updateGitignore(installDir: string): Promise<void> {
  const gitignorePath = path.join(installDir, '.gitignore');
  let content = '';

  // Read existing .gitignore
  try {
    content = await fs.readFile(gitignorePath, 'utf8');
  } catch {
    // File doesn't exist, create new one
  }

  // Check if .env.local is already ignored
  if (!content.includes('.env.local')) {
    content += '\n# Environment variables with secrets\n.env.local\n';
    await fs.writeFile(gitignorePath, content, 'utf8');
  }
}
