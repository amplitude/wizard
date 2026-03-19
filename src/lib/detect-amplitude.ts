/**
 * detect-amplitude — Static heuristics to check if Amplitude is already
 * installed in the project directory, without calling any APIs or AI.
 *
 * Checks (in order of confidence):
 *   1. package.json — Amplitude npm packages in dependencies
 *   2. Python requirements files — amplitude-analytics in requirements.txt,
 *      pyproject.toml, setup.cfg, or setup.py
 *   3. Source code imports — grep for amplitude import statements
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

// ── Source-code import grep ──────────────────────────────────────────

const JS_AMPLITUDE_IMPORT_RE =
  /from\s+['"]@?amplitude\b|require\s*\(\s*['"]@?amplitude\b/;
const PY_AMPLITUDE_IMPORT_RE = /^\s*(from\s+amplitude\b|import\s+amplitude\b)/m;

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
]);

const JS_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const PY_EXTS = new Set(['.py']);

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
        if (!JS_EXTS.has(ext) && !PY_EXTS.has(ext)) continue;

        checked++;
        try {
          const content = fs.readFileSync(
            path.join(current, entry.name),
            'utf-8',
          );
          const re = JS_EXTS.has(ext)
            ? JS_AMPLITUDE_IMPORT_RE
            : PY_AMPLITUDE_IMPORT_RE;
          if (re.test(content)) {
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
  const jsCheck = checkPackageJson(installDir);
  if (jsCheck.confidence !== 'none') return jsCheck;

  const pyCheck = checkPythonRequirements(installDir);
  if (pyCheck.confidence !== 'none') return pyCheck;

  return grepSourceFiles(installDir);
}
