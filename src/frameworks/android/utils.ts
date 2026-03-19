import fg from 'fast-glob';
import type { WizardOptions } from '../../utils/types';

/**
 * Returns true when the directory contains an Android project.
 * Primary signal: AndroidManifest.xml (Android-specific; not present in pure JVM projects).
 */
export async function detectAndroidProject(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<boolean> {
  const manifests = await fg('**/AndroidManifest.xml', {
    cwd: options.installDir,
    ignore: ['**/node_modules/**', '**/build/**', '**/.gradle/**'],
    deep: 6,
  });
  return manifests.length > 0;
}

/**
 * Returns the primary language used in the Android project.
 * Presence of any .kt source file → Kotlin; otherwise assumes Java.
 */
export async function detectAndroidLanguage(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<'kotlin' | 'java'> {
  const kotlinFiles = await fg('**/*.kt', {
    cwd: options.installDir,
    ignore: ['**/node_modules/**', '**/build/**', '**/.gradle/**'],
    deep: 8,
  });
  return kotlinFiles.length > 0 ? 'kotlin' : 'java';
}
