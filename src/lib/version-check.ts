import * as semver from 'semver';
import type { FrameworkDetection } from './framework-config';
import type { WizardOptions } from '../utils/types';

export interface VersionCheckInfo {
  version?: string;
  minimumVersion?: string;
  packageDisplayName?: string;
}

type VersionWarningOptions = {
  coerceVersion?: boolean;
};

/**
 * Resolve version-check metadata for frameworks that either rely on a single
 * package (minimumVersion + getInstalledVersion) or multiple package backends.
 */
export async function getVersionCheckInfo(
  detection: FrameworkDetection,
  options: WizardOptions,
): Promise<VersionCheckInfo> {
  if (detection.getVersionCheckInfo) {
    const info = await detection.getVersionCheckInfo(options);
    return {
      version: info.version,
      minimumVersion: info.minimumVersion ?? detection.minimumVersion,
      packageDisplayName:
        info.packageDisplayName ?? detection.packageDisplayName,
    };
  }

  if (!detection.getInstalledVersion) {
    return {};
  }

  return {
    version: await detection.getInstalledVersion(options),
    minimumVersion: detection.minimumVersion,
    packageDisplayName: detection.packageDisplayName,
  };
}

export function getVersionWarning(
  { version, minimumVersion, packageDisplayName }: VersionCheckInfo,
  options: VersionWarningOptions = {},
): string | undefined {
  if (!version || !minimumVersion || !packageDisplayName) {
    return undefined;
  }

  const normalizedVersion = options.coerceVersion
    ? semver.coerce(version)?.version
    : semver.valid(version);
  if (!normalizedVersion || !semver.lt(normalizedVersion, minimumVersion)) {
    return undefined;
  }

  return `${packageDisplayName} ${version} is below minimum ${minimumVersion}`;
}
