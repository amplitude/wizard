/**
 * Git utilities for safety checks
 */
import { execSync } from 'child_process';

/**
 * Check if current directory is inside a git repository
 */
export function isInGitRepo(installDir: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd: installDir,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get list of uncommitted or untracked files
 */
export function getUncommittedFiles(installDir: string): string[] {
  try {
    const output = execSync('git status --porcelain', {
      cwd: installDir,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    if (!output.trim()) {
      return [];
    }

    return output
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}
