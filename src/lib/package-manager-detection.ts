/**
 * Cross-ecosystem package manager detection.
 *
 * Provides a common interface (PackageManagerDetector) that each FrameworkConfig
 * implements, plus shared helpers for Node.js, Python, PHP, and Swift ecosystems.
 * The MCP tool in wizard-tools.ts delegates to whatever detector the
 * current framework supplies.
 */

import {
  detectPackageManager as detectPythonPM,
  PythonPackageManager,
} from '../frameworks/python/utils';
import { detectNodePackageManagersLight } from './package-manager-detection-light';
import type {
  DetectedPackageManager,
  PackageManagerInfo,
} from './package-manager-detection-types';

// ---------------------------------------------------------------------------
// Common types — re-exported from the shared types module so the lightweight
// detection helpers (`package-manager-detection-light.ts`) and full module
// don't need to import from each other.
// ---------------------------------------------------------------------------

export type {
  DetectedPackageManager,
  PackageManagerInfo,
  PackageManagerDetector,
} from './package-manager-detection-types';

// ---------------------------------------------------------------------------
// Node.js helper
//
// Delegates to the dependency-free `detectNodePackageManagersLight` so both
// the heavy and light call sites stay in sync. Detection cold paths should
// import the light version directly (see `src/lib/package-manager-detection-light.ts`).
// ---------------------------------------------------------------------------

export function detectNodePackageManagers(
  installDir: string,
): Promise<PackageManagerInfo> {
  return detectNodePackageManagersLight(installDir);
}

// ---------------------------------------------------------------------------
// Python helper
// ---------------------------------------------------------------------------

const PYTHON_PM_INFO: Record<PythonPackageManager, DetectedPackageManager> = {
  [PythonPackageManager.UV]: {
    name: 'uv',
    label: 'uv',
    installCommand: 'uv add',
    runCommand: 'uv run',
  },
  [PythonPackageManager.POETRY]: {
    name: 'poetry',
    label: 'Poetry',
    installCommand: 'poetry add',
    runCommand: 'poetry run',
  },
  [PythonPackageManager.PDM]: {
    name: 'pdm',
    label: 'PDM',
    installCommand: 'pdm add',
    runCommand: 'pdm run',
  },
  [PythonPackageManager.HATCH]: {
    name: 'hatch',
    label: 'Hatch',
    installCommand: 'hatch add',
    runCommand: 'hatch run',
  },
  [PythonPackageManager.RYE]: {
    name: 'rye',
    label: 'Rye',
    installCommand: 'rye add',
    runCommand: 'rye run',
  },
  [PythonPackageManager.PIPENV]: {
    name: 'pipenv',
    label: 'Pipenv',
    installCommand: 'pipenv install',
    runCommand: 'pipenv run',
  },
  [PythonPackageManager.CONDA]: {
    name: 'conda',
    label: 'Conda',
    installCommand: 'conda install',
    runCommand: 'conda run',
  },
  [PythonPackageManager.PIP]: {
    name: 'pip',
    label: 'pip',
    installCommand: 'pip install',
  },
  [PythonPackageManager.UNKNOWN]: {
    name: 'pip',
    label: 'pip (default)',
    installCommand: 'pip install',
  },
};

/**
 * Detect Python package managers via lockfiles and config files.
 * Wraps the existing detectPackageManager() from python/utils.ts.
 */
export async function detectPythonPackageManagers(
  installDir: string,
): Promise<PackageManagerInfo> {
  const pm = await detectPythonPM({
    installDir,
  } as Parameters<typeof detectPythonPM>[0]);
  const info = PYTHON_PM_INFO[pm];

  return {
    detected: [info],
    primary: info,
    recommendation: `Use ${info.label} (${info.installCommand}).`,
  };
}

// ---------------------------------------------------------------------------
// PHP (Composer) helper
// ---------------------------------------------------------------------------

const COMPOSER: DetectedPackageManager = {
  name: 'composer',
  label: 'Composer',
  installCommand: 'composer require',
};

export function composerPackageManager(): Promise<PackageManagerInfo> {
  return Promise.resolve({
    detected: [COMPOSER],
    primary: COMPOSER,
    recommendation: 'Use Composer (composer require).',
  });
}

// ---------------------------------------------------------------------------
// Swift (SPM) helper
// ---------------------------------------------------------------------------

const SPM: DetectedPackageManager = {
  name: 'spm',
  label: 'Swift Package Manager',
  installCommand: 'swift package add-dependency',
};

export function swiftPackageManager(): Promise<PackageManagerInfo> {
  return Promise.resolve({
    detected: [SPM],
    primary: SPM,
    recommendation:
      'Use Swift Package Manager. Add the dependency to Package.swift or via Xcode.',
  });
}

// ---------------------------------------------------------------------------
// Java (Maven / Gradle) helper
// ---------------------------------------------------------------------------

const MAVEN: DetectedPackageManager = {
  name: 'maven',
  label: 'Maven',
  installCommand: 'mvn',
  runCommand: 'mvn exec:java',
};

const GRADLE_JAVA: DetectedPackageManager = {
  name: 'gradle',
  label: 'Gradle',
  installCommand: 'gradle',
  runCommand: 'gradle run',
};

export async function detectJavaPackageManagers(
  installDir: string,
): Promise<PackageManagerInfo> {
  const fs = await import('node:fs');
  const nodePath = await import('node:path');

  const hasMaven = fs.existsSync(nodePath.join(installDir, 'pom.xml'));
  const hasGradle =
    fs.existsSync(nodePath.join(installDir, 'build.gradle')) ||
    fs.existsSync(nodePath.join(installDir, 'build.gradle.kts'));

  if (hasMaven) {
    return {
      detected: [MAVEN],
      primary: MAVEN,
      recommendation:
        'Use Maven: add the dependency to pom.xml and run mvn install.',
    };
  }
  if (hasGradle) {
    return {
      detected: [GRADLE_JAVA],
      primary: GRADLE_JAVA,
      recommendation:
        'Use Gradle: add the implementation dependency to build.gradle and sync.',
    };
  }
  return {
    detected: [MAVEN],
    primary: MAVEN,
    recommendation: 'No build file detected. Defaulting to Maven.',
  };
}

// ---------------------------------------------------------------------------
// Flutter (pub) helper
// ---------------------------------------------------------------------------

const FLUTTER_PUB: DetectedPackageManager = {
  name: 'flutter',
  label: 'Flutter pub',
  installCommand: 'flutter pub add',
  runCommand: 'flutter pub run',
};

export function flutterPackageManager(): Promise<PackageManagerInfo> {
  return Promise.resolve({
    detected: [FLUTTER_PUB],
    primary: FLUTTER_PUB,
    recommendation: 'Use Flutter pub (flutter pub add).',
  });
}

// ---------------------------------------------------------------------------
// Go (modules) helper
// ---------------------------------------------------------------------------

const GO_MODULES: DetectedPackageManager = {
  name: 'go',
  label: 'Go modules',
  installCommand: 'go get',
  runCommand: 'go run',
};

export function goPackageManager(): Promise<PackageManagerInfo> {
  return Promise.resolve({
    detected: [GO_MODULES],
    primary: GO_MODULES,
    recommendation: 'Use Go modules (go get).',
  });
}

// ---------------------------------------------------------------------------
// Unity (UPM) helper
// ---------------------------------------------------------------------------

const UNITY_UPM: DetectedPackageManager = {
  name: 'unity',
  label: 'Unity Package Manager',
  installCommand:
    'Add to Packages/manifest.json dependencies: "com.amplitude.unity-plugin": "https://github.com/amplitude/unity-plugin.git?path=/Assets"',
};

export function unityPackageManager(): Promise<PackageManagerInfo> {
  return Promise.resolve({
    detected: [UNITY_UPM],
    primary: UNITY_UPM,
    recommendation:
      'Use Unity Package Manager: add the git URL dependency to Packages/manifest.json.',
  });
}

// ---------------------------------------------------------------------------
// Unreal Engine helper
// ---------------------------------------------------------------------------

const UNREAL_MANUAL: DetectedPackageManager = {
  name: 'unreal',
  label: 'Manual plugin install',
  installCommand:
    'Download AmplitudeUnreal.zip from https://github.com/amplitude/Amplitude-Unreal/releases/latest and extract into Plugins/AmplitudeUnreal/',
};

export function unrealPackageManager(): Promise<PackageManagerInfo> {
  return Promise.resolve({
    detected: [UNREAL_MANUAL],
    primary: UNREAL_MANUAL,
    recommendation:
      'Unreal Engine uses manual plugin installation. Download the zip from GitHub releases and extract it into the project Plugins/ directory.',
  });
}

// ---------------------------------------------------------------------------
// Ruby (Bundler) helper
// ---------------------------------------------------------------------------

const BUNDLER: DetectedPackageManager = {
  name: 'bundler',
  label: 'Bundler',
  installCommand: 'bundle add',
  runCommand: 'bundle exec',
};

export function bundlerPackageManager(): Promise<PackageManagerInfo> {
  return Promise.resolve({
    detected: [BUNDLER],
    primary: BUNDLER,
    recommendation: 'Use Bundler (bundle add). Run commands with bundle exec.',
  });
}

// ---------------------------------------------------------------------------
// Android (Gradle) helper
// ---------------------------------------------------------------------------

const GRADLE: DetectedPackageManager = {
  name: 'gradle',
  label: 'Gradle',
  installCommand: 'implementation',
};

export function gradlePackageManager(): Promise<PackageManagerInfo> {
  return Promise.resolve({
    detected: [GRADLE],
    primary: GRADLE,
    recommendation:
      'Add dependencies to build.gradle(.kts) using implementation().',
  });
}
