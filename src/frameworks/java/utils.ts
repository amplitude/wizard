import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WizardOptions } from '../../utils/types';

export type JavaBuildTool = 'maven' | 'gradle';

/**
 * Returns true when the directory contains a JVM Java project.
 * Signals: pom.xml (Maven), build.gradle / build.gradle.kts (Gradle),
 * or a src/main/java directory (standard Maven/Gradle layout).
 *
 * Note: Android projects also use build.gradle, but they are detected
 * earlier in the registry and will never reach this detector.
 */
export function detectJavaProject(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<boolean> {
  const { installDir } = options;
  const hasPom = fs.existsSync(path.join(installDir, 'pom.xml'));
  const hasGradle =
    fs.existsSync(path.join(installDir, 'build.gradle')) ||
    fs.existsSync(path.join(installDir, 'build.gradle.kts'));
  const hasSrcMainJava = fs.existsSync(
    path.join(installDir, 'src', 'main', 'java'),
  );
  return Promise.resolve(hasPom || hasGradle || hasSrcMainJava);
}

/**
 * Returns the detected build tool for the Java project.
 */
export function detectJavaBuildTool(
  options: Pick<WizardOptions, 'installDir'>,
): JavaBuildTool {
  const { installDir } = options;
  if (fs.existsSync(path.join(installDir, 'pom.xml'))) return 'maven';
  return 'gradle';
}
