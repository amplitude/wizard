import * as fs from 'node:fs';
import * as path from 'node:path';
import fg from 'fast-glob';
import type { WizardOptions } from '../../utils/types';

export type SwiftPackageManager = 'spm' | 'cocoapods';

/**
 * Returns the package manager used by the Swift project.
 * CocoaPods takes priority when a Podfile is present.
 */
export function detectSwiftPackageManager(
  options: Pick<WizardOptions, 'installDir'>,
): SwiftPackageManager {
  if (fs.existsSync(path.join(options.installDir, 'Podfile'))) {
    return 'cocoapods';
  }
  return 'spm';
}

/**
 * Returns true when the directory contains an iOS/macOS Swift project.
 * Signals: *.xcodeproj directory, Podfile, or Package.swift + .swift sources.
 */
export async function detectSwiftProject(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<boolean> {
  const { installDir } = options;

  // Xcode project or workspace
  const xcodeProjects = await fg(['*.xcodeproj', '*.xcworkspace'], {
    cwd: installDir,
    onlyDirectories: true,
    deep: 1,
  });
  if (xcodeProjects.length > 0) {
    return true;
  }

  // CocoaPods Podfile
  if (fs.existsSync(path.join(installDir, 'Podfile'))) {
    return true;
  }

  // Package.swift with at least one .swift source file
  if (fs.existsSync(path.join(installDir, 'Package.swift'))) {
    const swiftFiles = await fg('Sources/**/*.swift', {
      cwd: installDir,
      ignore: ['**/.build/**'],
    });
    return swiftFiles.length > 0;
  }

  return false;
}
