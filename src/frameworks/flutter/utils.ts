import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WizardOptions } from '../../utils/types';

/**
 * Returns true when the directory contains a Flutter project.
 * A Flutter project has pubspec.yaml that references the flutter SDK,
 * or has the characteristic android/ + ios/ sibling directories.
 */
export function detectFlutterProject(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<boolean> {
  const { installDir } = options;

  const pubspecPath = path.join(installDir, 'pubspec.yaml');
  if (!fs.existsSync(pubspecPath)) {
    return Promise.resolve(false);
  }

  // Check for flutter SDK reference in pubspec.yaml
  try {
    const content = fs.readFileSync(pubspecPath, 'utf-8');
    if (/^\s*flutter\s*:/m.test(content) || content.includes('sdk: flutter')) {
      return Promise.resolve(true);
    }
  } catch {
    // fall through to directory check
  }

  // Fallback: typical Flutter project has both android/ and ios/ dirs
  const hasAndroid = fs.existsSync(path.join(installDir, 'android'));
  const hasIos = fs.existsSync(path.join(installDir, 'ios'));
  return Promise.resolve(hasAndroid && hasIos);
}
