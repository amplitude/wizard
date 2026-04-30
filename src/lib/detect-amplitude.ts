/**
 * detect-amplitude — Static heuristics to check if Amplitude is already
 * installed in the project directory, without calling any APIs or AI.
 *
 * Checks (in order of confidence):
 *   1. package.json — Amplitude npm packages in dependencies
 *   2. Python requirements files — amplitude-analytics
 *   3. Swift — Podfile or Package.resolved
 *   4. Android / Java — build.gradle / build.gradle.kts
 *   5. Flutter — pubspec.yaml
 *   6. Go — go.mod
 *   7. Unreal Engine — Config/DefaultEngine.ini or Plugins/AmplitudeUnreal/
 *   8. Unity — Packages/manifest.json
 *   9. Source code imports — grep for amplitude import statements
 *
 * Returns a confidence level so callers can decide how to act:
 *   'high'   — package file explicitly lists an Amplitude SDK
 *   'low'    — import found in source but no package file entry
 *   'none'   — no evidence found
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export type AmplitudeDetectionConfidence = 'high' | 'low' | 'none';

export interface AmplitudeDetectionResult {
  confidence: AmplitudeDetectionConfidence;
  /** Human-readable reason for the confidence level */
  reason: string | null;
}

// ── npm packages ─────────────────────────────────────────────────────

const AMPLITUDE_NPM_PACKAGES = [
  '@amplitude/analytics-browser',
  '@amplitude/analytics-node',
  '@amplitude/analytics-react-native',
  '@amplitude/unified',
  'amplitude-js', // legacy browser SDK
];

function checkPackageJson(dir: string): AmplitudeDetectionResult {
  const pkgPath = path.join(dir, 'package.json');
  try {
    const raw = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of AMPLITUDE_NPM_PACKAGES) {
      if (allDeps[name]) {
        return { confidence: 'high', reason: `${name} found in package.json` };
      }
    }
  } catch {
    // No package.json or invalid JSON — not a JS project
  }
  return { confidence: 'none', reason: null };
}

// ── Python requirements ──────────────────────────────────────────────

/** Matches `amplitude-analytics` with optional version specifier */
const PYTHON_AMPLITUDE_RE = /^\s*amplitude[-_]analytics\b/im;

function checkPythonRequirements(dir: string): AmplitudeDetectionResult {
  const candidates = [
    'requirements.txt',
    'requirements-dev.txt',
    'requirements/base.txt',
    'requirements/common.txt',
  ];

  for (const rel of candidates) {
    try {
      const content = fs.readFileSync(path.join(dir, rel), 'utf-8');
      if (PYTHON_AMPLITUDE_RE.test(content)) {
        return {
          confidence: 'high',
          reason: `amplitude-analytics found in ${rel}`,
        };
      }
    } catch {
      // File doesn't exist — skip
    }
  }

  // pyproject.toml
  try {
    const content = fs.readFileSync(path.join(dir, 'pyproject.toml'), 'utf-8');
    if (PYTHON_AMPLITUDE_RE.test(content)) {
      return {
        confidence: 'high',
        reason: 'amplitude-analytics found in pyproject.toml',
      };
    }
  } catch {
    // Not a Python project or no pyproject.toml
  }

  // setup.cfg / setup.py
  for (const file of ['setup.cfg', 'setup.py']) {
    try {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      if (PYTHON_AMPLITUDE_RE.test(content)) {
        return {
          confidence: 'high',
          reason: `amplitude-analytics found in ${file}`,
        };
      }
    } catch {
      // Skip
    }
  }

  return { confidence: 'none', reason: null };
}

// ── Swift (CocoaPods / Swift Package Manager) ────────────────────────

function checkSwiftPackages(dir: string): AmplitudeDetectionResult {
  // CocoaPods Podfile
  try {
    const podfile = fs.readFileSync(path.join(dir, 'Podfile'), 'utf-8');
    if (/pod\s+['"]AmplitudeUnified['"]/i.test(podfile)) {
      return {
        confidence: 'high',
        reason: 'AmplitudeUnified found in Podfile',
      };
    }
  } catch {
    // No Podfile
  }

  // Swift Package Manager — Package.resolved (locked dependency graph)
  for (const rel of [
    'Package.resolved',
    '.package/checkouts/.resolved',
    '.build/workspace-state.json', // fallback
  ]) {
    try {
      const content = fs.readFileSync(path.join(dir, rel), 'utf-8');
      if (
        content.includes('AmplitudeUnified-Swift') ||
        content.includes('amplitude/AmplitudeUnified')
      ) {
        return {
          confidence: 'high',
          reason: `AmplitudeUnified found in ${rel}`,
        };
      }
    } catch {
      // Skip
    }
  }

  return { confidence: 'none', reason: null };
}

// ── Android / Java (Gradle) ──────────────────────────────────────────

const GRADLE_AMPLITUDE_RE = /com\.amplitude:(analytics-android|java-sdk)/;

function checkGradleFiles(dir: string): AmplitudeDetectionResult {
  const candidates = [
    'build.gradle',
    'build.gradle.kts',
    'app/build.gradle',
    'app/build.gradle.kts',
  ];
  for (const rel of candidates) {
    try {
      const content = fs.readFileSync(path.join(dir, rel), 'utf-8');
      if (GRADLE_AMPLITUDE_RE.test(content)) {
        return {
          confidence: 'high',
          reason: `Amplitude dependency found in ${rel}`,
        };
      }
    } catch {
      // Skip
    }
  }
  return { confidence: 'none', reason: null };
}

// ── Flutter (pubspec.yaml) ───────────────────────────────────────────

function checkPubspecYaml(dir: string): AmplitudeDetectionResult {
  try {
    const content = fs.readFileSync(path.join(dir, 'pubspec.yaml'), 'utf-8');
    if (/^\s*amplitude_flutter\s*:/m.test(content)) {
      return {
        confidence: 'high',
        reason: 'amplitude_flutter found in pubspec.yaml',
      };
    }
  } catch {
    // No pubspec.yaml
  }
  return { confidence: 'none', reason: null };
}

// ── Go (go.mod) ──────────────────────────────────────────────────────

function checkGoMod(dir: string): AmplitudeDetectionResult {
  try {
    const content = fs.readFileSync(path.join(dir, 'go.mod'), 'utf-8');
    if (content.includes('github.com/amplitude/analytics-go')) {
      return {
        confidence: 'high',
        reason: 'github.com/amplitude/analytics-go found in go.mod',
      };
    }
  } catch {
    // No go.mod
  }
  return { confidence: 'none', reason: null };
}

// ── Unreal Engine ────────────────────────────────────────────────────

function checkUnrealConfig(dir: string): AmplitudeDetectionResult {
  // Config/DefaultEngine.ini with Amplitude analytics provider
  try {
    const content = fs.readFileSync(
      path.join(dir, 'Config', 'DefaultEngine.ini'),
      'utf-8',
    );
    if (
      /AmplitudeApiKey\s*=|ProviderModuleName\s*=\s*Amplitude/i.test(content)
    ) {
      return {
        confidence: 'high',
        reason: 'Amplitude configured in Config/DefaultEngine.ini',
      };
    }
  } catch {
    // No config
  }

  // Plugin already extracted into Plugins/
  if (
    fs.existsSync(
      path.join(dir, 'Plugins', 'AmplitudeUnreal', 'Amplitude.uplugin'),
    )
  ) {
    return {
      confidence: 'high',
      reason: 'AmplitudeUnreal plugin found in Plugins/',
    };
  }

  return { confidence: 'none', reason: null };
}

// ── Unity ────────────────────────────────────────────────────────────

function checkUnityManifest(dir: string): AmplitudeDetectionResult {
  // UPM manifest
  try {
    const content = fs.readFileSync(
      path.join(dir, 'Packages', 'manifest.json'),
      'utf-8',
    );
    if (content.includes('amplitude/unity-plugin')) {
      return {
        confidence: 'high',
        reason: 'amplitude/unity-plugin found in Packages/manifest.json',
      };
    }
  } catch {
    // No manifest
  }

  // Manual .unitypackage import lands under Assets/Amplitude/
  if (fs.existsSync(path.join(dir, 'Assets', 'Amplitude'))) {
    return {
      confidence: 'high',
      reason: 'Amplitude assets found in Assets/Amplitude/',
    };
  }

  return { confidence: 'none', reason: null };
}

// ── Source-code import grep ──────────────────────────────────────────

const JS_AMPLITUDE_IMPORT_RE =
  /from\s+['"]@?amplitude\b|require\s*\(\s*['"]@?amplitude\b/;
const PY_AMPLITUDE_IMPORT_RE = /^\s*(from\s+amplitude\b|import\s+amplitude\b)/m;
const SWIFT_AMPLITUDE_IMPORT_RE =
  /import\s+AmplitudeUnified|Amplitude\s*\(\s*apiKey:/;
const KOTLIN_JAVA_AMPLITUDE_RE = /com\.amplitude\b/;
const GO_AMPLITUDE_IMPORT_RE = /["']github\.com\/amplitude\/analytics-go/;
const DART_AMPLITUDE_IMPORT_RE = /amplitude_flutter|amplitude\.track\b/;
const CSHARP_AMPLITUDE_RE = /Amplitude\.getInstance\b|Amplitude\.Instance\b/;

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  '.turbo',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
  'env',
  // Native build output dirs
  '.build',
  'Pods',
  'DerivedData',
  '.gradle',
  'Library', // Unity Library cache
]);

const JS_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const PY_EXTS = new Set(['.py']);
const SWIFT_EXTS = new Set(['.swift']);
const KOTLIN_JAVA_EXTS = new Set(['.kt', '.java']);
const GO_EXTS = new Set(['.go']);
const DART_EXTS = new Set(['.dart']);
const CSHARP_EXTS = new Set(['.cs']);

function getImportRegex(ext: string): RegExp | null {
  if (JS_EXTS.has(ext)) return JS_AMPLITUDE_IMPORT_RE;
  if (PY_EXTS.has(ext)) return PY_AMPLITUDE_IMPORT_RE;
  if (SWIFT_EXTS.has(ext)) return SWIFT_AMPLITUDE_IMPORT_RE;
  if (KOTLIN_JAVA_EXTS.has(ext)) return KOTLIN_JAVA_AMPLITUDE_RE;
  if (GO_EXTS.has(ext)) return GO_AMPLITUDE_IMPORT_RE;
  if (DART_EXTS.has(ext)) return DART_AMPLITUDE_IMPORT_RE;
  if (CSHARP_EXTS.has(ext)) return CSHARP_AMPLITUDE_RE;
  return null;
}

const ALL_SCANNED_EXTS = new Set([
  ...JS_EXTS,
  ...PY_EXTS,
  ...SWIFT_EXTS,
  ...KOTLIN_JAVA_EXTS,
  ...GO_EXTS,
  ...DART_EXTS,
  ...CSHARP_EXTS,
]);

function grepSourceFiles(
  dir: string,
  maxFiles = 200,
): AmplitudeDetectionResult {
  let checked = 0;

  function walk(current: string): string | null {
    if (checked >= maxFiles) return null;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return null;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        const found = walk(path.join(current, entry.name));
        if (found) return found;
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!ALL_SCANNED_EXTS.has(ext)) continue;

        checked++;
        try {
          const content = fs.readFileSync(
            path.join(current, entry.name),
            'utf-8',
          );
          const re = getImportRegex(ext);
          if (re && re.test(content)) {
            return path.relative(dir, path.join(current, entry.name));
          }
        } catch {
          // Unreadable file — skip
        }
      }
    }
    return null;
  }

  const hit = walk(dir);
  if (hit) {
    return { confidence: 'low', reason: `Amplitude import found in ${hit}` };
  }
  return { confidence: 'none', reason: null };
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Run all static checks in priority order.
 * Returns the first non-'none' result, or 'none' if nothing found.
 */
export function detectAmplitudeInProject(
  installDir: string,
): AmplitudeDetectionResult {
  const checks = [
    checkPackageJson,
    checkPythonRequirements,
    checkSwiftPackages,
    checkGradleFiles,
    checkPubspecYaml,
    checkGoMod,
    checkUnrealConfig,
    checkUnityManifest,
  ];

  for (const check of checks) {
    const result = check(installDir);
    if (result.confidence !== 'none') return result;
  }

  return grepSourceFiles(installDir);
}

/**
 * Source-only Amplitude detection — ignores package.json / lockfile metadata
 * and only searches actual source code for an Amplitude import statement.
 *
 * Use this to corroborate that the SDK is *wired up*, not just installed.
 * Distinguishes "the dep is in package.json but no file actually imports it"
 * (stale install) from "the SDK is actually being used at runtime".
 *
 * Returns 'low' on a hit (because grepping source is intrinsically a weaker
 * signal than a package-file declaration), or 'none' if nothing imports
 * Amplitude anywhere under `installDir`.
 */
export function detectAmplitudeInProjectSource(
  installDir: string,
): AmplitudeDetectionResult {
  return grepSourceFiles(installDir);
}

/**
 * Per-signal breakdown of "is this project fully wired up?". Used by the
 * Activation Check pre-flight to decide whether a re-run can skip the agent
 * loop entirely. Each boolean is a hard yes/no on a single local artifact:
 *
 *   - `dependency`     — Amplitude SDK declared in package.json /
 *                        requirements / Podfile / build.gradle / etc.
 *                        (the same checks `detectAmplitudeInProject` runs).
 *   - `sourceImport`   — at least one source file actually imports the SDK
 *                        and uses it (`detectAmplitudeInProjectSource`).
 *   - `ampliConfig`    — `ampli.json` exists with a non-empty OrgId AND
 *                        ProjectId (so the next run can recover scope
 *                        without re-prompting).
 *   - `eventPlan`      — `.amplitude/events.json` (or root-level
 *                        `.amplitude-events.json`) exists and is
 *                        non-empty array — i.e. the user has already
 *                        approved an event plan.
 *
 * Returns `fullyWired` true when ALL four signals are present. `present`
 * and `missing` lists let the caller log exactly why the short-circuit
 * fired or didn't (useful for triaging "but I had it set up!" reports).
 */
export interface FullyWiredCheck {
  fullyWired: boolean;
  signals: {
    dependency: boolean;
    sourceImport: boolean;
    ampliConfig: boolean;
    eventPlan: boolean;
  };
  /** Names of signals that PASSED — for log/UI summary. */
  present: string[];
  /** Names of signals that FAILED — for log/UI summary. */
  missing: string[];
}

function readJsonSafely(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
  } catch {
    return null;
  }
}

function hasAmpliConfigScope(installDir: string): boolean {
  const config = readJsonSafely(path.join(installDir, 'ampli.json'));
  if (!config || typeof config !== 'object') return false;
  const c = config as Record<string, unknown>;
  return (
    typeof c.OrgId === 'string' &&
    c.OrgId.length > 0 &&
    typeof c.ProjectId === 'string' &&
    c.ProjectId.length > 0
  );
}

function hasEventPlan(installDir: string): boolean {
  // Read both the canonical (.amplitude/events.json) and legacy
  // (.amplitude-events.json) locations. PR #2 in the bugbot follow-up
  // series consolidates these; this dual-read keeps the activation
  // pre-flight resilient across that migration.
  for (const rel of ['.amplitude/events.json', '.amplitude-events.json']) {
    const data = readJsonSafely(path.join(installDir, rel));
    if (Array.isArray(data) && data.length > 0) return true;
  }
  return false;
}

/**
 * Pre-flight check used by the Activation flow: are all four local
 * "this project was fully set up by a prior wizard run" signals present?
 *
 * When the answer is yes, the wizard can short-circuit past the agent loop
 * (Setup + Run screens) and route directly to the ingestion poll — re-runs
 * on already-instrumented projects no longer waste 2-3 minutes re-running
 * the agent on a no-op. The remote-events check that drives `'full'` still
 * runs INSIDE DataIngestionCheckScreen on its own polling cadence; this
 * function only governs whether the agent loop runs at all.
 *
 * Pure function over the filesystem; no API calls, no side-effects. Safe
 * to call from synchronous render paths.
 */
export function isProjectFullyWired(installDir: string): FullyWiredCheck {
  const dependency = detectAmplitudeInProject(installDir).confidence !== 'none';
  const sourceImport =
    detectAmplitudeInProjectSource(installDir).confidence !== 'none';
  const ampliConfig = hasAmpliConfigScope(installDir);
  const eventPlan = hasEventPlan(installDir);

  const signals = { dependency, sourceImport, ampliConfig, eventPlan };
  const present: string[] = [];
  const missing: string[] = [];
  for (const [name, value] of Object.entries(signals)) {
    (value ? present : missing).push(name);
  }

  return {
    fullyWired: dependency && sourceImport && ampliConfig && eventPlan,
    signals,
    present,
    missing,
  };
}
