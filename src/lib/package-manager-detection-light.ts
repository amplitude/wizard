/**
 * Lightweight Node.js package manager detection used by framework detect()
 * callbacks.
 *
 * The full `package-manager-detection.ts` module pulls in `traceStep` (→
 * `analytics` → `@amplitude/analytics-node`), Python detector helpers, and
 * static metadata for every supported ecosystem. None of that is needed
 * during framework detection — the cold path just needs to look for
 * lockfiles. This module has zero non-stdlib dependencies so frameworks can
 * import it without paying the full graph cost.
 *
 * Behavior must stay identical to `detectNodePackageManagers` in
 * `package-manager-detection.ts`. The full module re-exports
 * `detectNodePackageManagers` from here so non-detection callers
 * (diagnostics, agent runner) keep their analytics side effects.
 */
import * as fs from 'node:fs';
import { join } from 'node:path';

import type {
  DetectedPackageManager,
  PackageManagerInfo,
} from './package-manager-detection-types';

// ---------------------------------------------------------------------------
// Lockfile-based PackageManager descriptors. Mirrors `package-manager.ts`
// but without any of the `getPackageDotJson` / analytics imports that file
// pulls in at module top-level.
//
// Adding a new package manager? Update both this file and
// `src/utils/package-manager.ts` together.
// ---------------------------------------------------------------------------

interface LightPackageManager {
  name: string;
  label: string;
  installCommand: string;
  runScriptCommand: string;
  detect: (installDir: string) => boolean;
}

const BUN: LightPackageManager = {
  name: 'bun',
  label: 'Bun',
  installCommand: 'bun add',
  runScriptCommand: 'bun run',
  detect: (installDir) =>
    ['bun.lockb', 'bun.lock'].some((lockFile) =>
      fs.existsSync(join(installDir, lockFile)),
    ),
};

const YARN_V1: LightPackageManager = {
  name: 'yarn',
  label: 'Yarn V1',
  installCommand: 'yarn add',
  runScriptCommand: 'yarn',
  detect: (installDir) => {
    try {
      return fs
        .readFileSync(join(installDir, 'yarn.lock'), 'utf-8')
        .slice(0, 500)
        .includes('yarn lockfile v1');
    } catch {
      return false;
    }
  },
};

const YARN_V2: LightPackageManager = {
  name: 'yarn',
  label: 'Yarn V2/3/4',
  installCommand: 'yarn add',
  runScriptCommand: 'yarn',
  detect: (installDir) => {
    try {
      return fs
        .readFileSync(join(installDir, 'yarn.lock'), 'utf-8')
        .slice(0, 500)
        .includes('__metadata');
    } catch {
      return false;
    }
  },
};

const PNPM: LightPackageManager = {
  name: 'pnpm',
  label: 'pnpm',
  installCommand: 'pnpm add',
  runScriptCommand: 'pnpm',
  detect: (installDir) => fs.existsSync(join(installDir, 'pnpm-lock.yaml')),
};

const NPM: LightPackageManager = {
  name: 'npm',
  label: 'npm',
  installCommand: 'npm add',
  runScriptCommand: 'npm run',
  detect: (installDir) => fs.existsSync(join(installDir, 'package-lock.json')),
};

const EXPO: LightPackageManager = {
  name: 'expo',
  label: 'Expo',
  installCommand: 'npx expo install',
  runScriptCommand: 'npx expo run',
  detect: () => false,
};

// Order matters — must match `packageManagers` in `src/utils/package-manager.ts`.
const PACKAGE_MANAGERS: LightPackageManager[] = [
  BUN,
  YARN_V1,
  YARN_V2,
  PNPM,
  NPM,
  EXPO,
];

function serialize(pm: LightPackageManager): DetectedPackageManager {
  return {
    name: pm.name,
    label: pm.label,
    installCommand: pm.installCommand,
    runCommand: pm.runScriptCommand,
  };
}

/**
 * Detect Node.js package managers via lockfiles, with no analytics or
 * telemetry side effects. Identical return shape to the heavyweight
 * `detectNodePackageManagers`.
 */
export function detectNodePackageManagersLight(
  installDir: string,
): Promise<PackageManagerInfo> {
  const detected: DetectedPackageManager[] = [];
  for (const pm of PACKAGE_MANAGERS) {
    if (pm.detect(installDir)) {
      detected.push(serialize(pm));
    }
  }

  if (detected.length === 0) {
    return Promise.resolve({
      detected: [],
      primary: null,
      recommendation: 'No lockfile found. Default to npm (npm add, npm run).',
    });
  }

  const primary = detected[0];
  return Promise.resolve({
    detected,
    primary,
    recommendation:
      detected.length === 1
        ? `Use ${primary.label} (${primary.installCommand}).`
        : `Multiple package managers detected. Prefer ${primary.label} (${primary.installCommand}).`,
  });
}
