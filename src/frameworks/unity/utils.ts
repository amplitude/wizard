import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WizardOptions } from '../../utils/types';

/**
 * Returns true when the directory contains a Unity project.
 * Primary signal: ProjectSettings/ProjectVersion.txt — Unity-specific,
 * present in every Unity project since 2017+.
 */
export function detectUnityProject(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<boolean> {
  return Promise.resolve(
    fs.existsSync(
      path.join(options.installDir, 'ProjectSettings', 'ProjectVersion.txt'),
    ),
  );
}

/**
 * Returns true if the Amplitude Unity plugin is already present,
 * either via UPM (Packages/manifest.json) or manual import (Assets/).
 */
export function isAmplitudePluginPresent(
  options: Pick<WizardOptions, 'installDir'>,
): boolean {
  // Check UPM manifest
  const manifestPath = path.join(
    options.installDir,
    'Packages',
    'manifest.json',
  );
  try {
    const manifest = fs.readFileSync(manifestPath, 'utf-8');
    if (manifest.includes('amplitude/unity-plugin')) return true;
  } catch {
    // no manifest
  }

  // Check for manually imported Assets
  const assetsAmplitudePath = path.join(
    options.installDir,
    'Assets',
    'Amplitude',
  );
  return fs.existsSync(assetsAmplitudePath);
}
