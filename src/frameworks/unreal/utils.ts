import fg from 'fast-glob';
import type { WizardOptions } from '../../utils/types';

/**
 * Returns true when the directory contains an Unreal Engine project.
 * Primary signal: a .uproject file at the project root (Unreal-specific JSON manifest).
 */
export async function detectUnrealProject(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<boolean> {
  const uprojectFiles = await fg('*.uproject', {
    cwd: options.installDir,
    deep: 1,
  });
  return uprojectFiles.length > 0;
}

/**
 * Returns true if the Amplitude plugin is already extracted into the project.
 */
export async function isAmplitudePluginPresent(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<boolean> {
  const upluginFiles = await fg('Plugins/AmplitudeUnreal/Amplitude.uplugin', {
    cwd: options.installDir,
    deep: 3,
  });
  return upluginFiles.length > 0;
}
