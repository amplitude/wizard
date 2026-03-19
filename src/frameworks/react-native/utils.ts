import * as fs from 'node:fs';
import * as path from 'node:path';
import { hasPackageInstalled } from '../../utils/package-json';
import { tryGetPackageJson } from '../../utils/setup-utils';
import type { WizardOptions } from '../../utils/types';

/**
 * Returns true when the directory contains a React Native project.
 *
 * Primary signal: package.json with `react-native` in dependencies or
 * devDependencies. This is the definitive indicator that distinguishes
 * React Native from:
 *   - Plain web apps (Next.js, Vite, CRA) — no `react-native` dep
 *   - Pure Android native projects — no package.json at all
 *   - Flutter — uses pubspec.yaml, detected earlier in the pipeline
 *
 * Note: The `javascript-web` detector already excludes `react-native`
 * via FRAMEWORK_PACKAGES, and this detector runs before `android` in
 * the registry so AndroidManifest.xml overlap is not a concern.
 */
export async function detectReactNativeProject(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<boolean> {
  const packageJson = await tryGetPackageJson(options);
  if (!packageJson) return false;
  return hasPackageInstalled('react-native', packageJson);
}

/**
 * Returns true if the React Native project uses Expo.
 * Checks for `expo` package or an app.json with a top-level "expo" key.
 */
export async function detectExpo(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<boolean> {
  const packageJson = await tryGetPackageJson(options);
  if (packageJson && hasPackageInstalled('expo', packageJson)) {
    return true;
  }

  // Expo managed workflow: app.json has { "expo": { ... } }
  const appJsonPath = path.join(options.installDir, 'app.json');
  try {
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf-8')) as Record<
      string,
      unknown
    >;
    if ('expo' in appJson) return true;
  } catch {
    // absent or unparseable — not Expo
  }

  return false;
}
