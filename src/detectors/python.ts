/**
 * Python framework detection utilities
 */
import { fileExists, directoryExists } from '../utils/file.js';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Common subdirectories where Python projects might be located
 */
const PYTHON_SUBDIRS = ['backend', 'server', 'api', 'src'];

/**
 * Check if a file exists in the root or common subdirectories
 */
async function findFileInPythonDirs(
  installDir: string,
  filename: string,
): Promise<string | null> {
  // Check root first
  if (await fileExists(installDir, filename)) {
    return installDir;
  }

  // Check common subdirectories
  for (const subdir of PYTHON_SUBDIRS) {
    if (await directoryExists(installDir, subdir)) {
      const subdirPath = path.join(installDir, subdir);
      if (await fileExists(subdirPath, filename)) {
        return subdirPath;
      }
    }
  }

  return null;
}

/**
 * Check if a Python package is installed by reading dependency files
 */
export async function hasPythonPackage(
  installDir: string,
  packageName: string,
): Promise<boolean> {
  // Check for requirements.txt in root or subdirectories
  const requirementsTxtDir = await findFileInPythonDirs(installDir, 'requirements.txt');
  if (requirementsTxtDir) {
    try {
      const content = await fs.readFile(
        path.join(requirementsTxtDir, 'requirements.txt'),
        'utf8',
      );
      if (content.toLowerCase().includes(packageName.toLowerCase())) {
        return true;
      }
    } catch {
      // Ignore errors
    }
  }

  // Check for Pipfile in root or subdirectories
  const pipfileDir = await findFileInPythonDirs(installDir, 'Pipfile');
  if (pipfileDir) {
    try {
      const content = await fs.readFile(path.join(pipfileDir, 'Pipfile'), 'utf8');
      if (content.toLowerCase().includes(packageName.toLowerCase())) {
        return true;
      }
    } catch {
      // Ignore errors
    }
  }

  // Check for pyproject.toml in root or subdirectories
  const pyprojectTomlDir = await findFileInPythonDirs(installDir, 'pyproject.toml');
  if (pyprojectTomlDir) {
    try {
      const content = await fs.readFile(
        path.join(pyprojectTomlDir, 'pyproject.toml'),
        'utf8',
      );
      if (content.toLowerCase().includes(packageName.toLowerCase())) {
        return true;
      }
    } catch {
      // Ignore errors
    }
  }

  return false;
}

/**
 * Detect Flask framework
 */
export async function detectFlask(installDir: string): Promise<boolean> {
  // Check for common Flask entry point files in root or subdirectories
  const flaskFiles = ['app.py', 'main.py', 'server.py', 'application.py'];

  for (const file of flaskFiles) {
    const foundDir = await findFileInPythonDirs(installDir, file);
    if (foundDir) {
      // Check for Flask in dependencies
      return await hasPythonPackage(installDir, 'flask');
    }
  }

  return false;
}

/**
 * Detect FastAPI framework
 */
export async function detectFastAPI(installDir: string): Promise<boolean> {
  // Check for common FastAPI entry point files in root or subdirectories
  const fastAPIFiles = ['main.py', 'app.py', 'server.py'];

  for (const file of fastAPIFiles) {
    const foundDir = await findFileInPythonDirs(installDir, file);
    if (foundDir) {
      // Check for FastAPI in dependencies
      return await hasPythonPackage(installDir, 'fastapi');
    }
  }

  return false;
}

/**
 * Detect Django framework
 */
export async function detectDjango(installDir: string): Promise<boolean> {
  // Django projects have manage.py in root or subdirectories
  const foundDir = await findFileInPythonDirs(installDir, 'manage.py');

  if (!foundDir) {
    return false;
  }

  // Check for Django in dependencies
  return await hasPythonPackage(installDir, 'django');
}
