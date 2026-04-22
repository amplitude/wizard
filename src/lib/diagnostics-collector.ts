/**
 * Diagnostics collector — gathers a structured snapshot of the user's
 * system, codebase, and wizard session state for attachment to /feedback
 * submissions. Opt-in: callers must obtain explicit user consent before
 * invoking collectDiagnostics().
 *
 * Design:
 * - Deterministic, in-process collection (no LLM). Schema-stable so
 *   downstream analytics can aggregate across submissions.
 * - Every field is individually try/catched so one failing probe doesn't
 *   drop the whole payload.
 * - Home directory paths are stripped from any string field that may
 *   leak them. No file contents, no env var values, no git remotes.
 */
import { homedir, arch, platform, release, type } from 'os';
import { readFile, access } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { z } from 'zod';
import {
  detectNodePackageManagers,
  type PackageManagerInfo,
} from './package-manager-detection.js';
import type { WizardSession } from './wizard-session.js';
import { RunPhase } from './wizard-session.js';

/** Bump when the schema changes in a way downstream consumers care about. */
export const DIAGNOSTICS_SCHEMA_VERSION = 1 as const;

/** Default budget for the full collection to keep /feedback responsive. */
const DEFAULT_TIMEOUT_MS = 3000;

/** Closed set of project files the collector is allowed to probe. */
type ProjectFile =
  | 'package.json'
  | 'tsconfig.json'
  | 'pnpm-workspace.yaml'
  | 'lerna.json'
  | 'turbo.json'
  | 'nx.json'
  | 'rush.json';

/** Repo size bucket boundaries (top-level entries in installDir). */
const REPO_SIZE_BUCKETS: Array<{ label: string; max: number }> = [
  { label: '<20', max: 20 },
  { label: '20-100', max: 100 },
  { label: '100-500', max: 500 },
  { label: '500+', max: Number.POSITIVE_INFINITY },
];

/**
 * Build a path to a known project file under installDir.
 * Uses manual concat with a closed set of basenames so no attacker-
 * controlled component can ever appear in the suffix. Trailing slash
 * on installDir is normalized. Node accepts forward slashes on Windows.
 */
function projectPath(installDir: string, file: ProjectFile): string {
  const base = installDir.replace(/[/\\]+$/, '');
  return `${base}/${file}`;
}

// ── Schema ─────────────────────────────────────────────────────────────

const SystemSchema = z.object({
  os: z.string(),
  os_release: z.string().nullable(),
  arch: z.string(),
  node_version: z.string(),
  shell: z.string().nullable(),
  term_program: z.string().nullable(),
  locale: z.string().nullable(),
  wizard_version: z.string(),
});

const CodebaseSchema = z.object({
  detected_frameworks: z.array(z.string()),
  package_managers: z.array(z.string()),
  has_typescript: z.boolean(),
  has_package_json: z.boolean(),
  amplitude_sdk_packages: z.array(
    z.object({
      name: z.string(),
      version: z.string(),
    }),
  ),
  dependency_counts: z.object({
    dependencies: z.number().int().nonnegative(),
    dev_dependencies: z.number().int().nonnegative(),
  }),
  monorepo: z.boolean(),
  repo_size_bucket: z.string(),
});

const SessionSchema = z.object({
  run_phase: z.string(),
  integration: z.string().nullable(),
  region: z.enum(['us', 'eu']).nullable(),
  intro_concluded: z.boolean(),
  setup_confirmed: z.boolean(),
  detection_complete: z.boolean(),
  has_credentials: z.boolean(),
});

export const DiagnosticsSchema = z.object({
  schema_version: z.literal(DIAGNOSTICS_SCHEMA_VERSION),
  collected_at: z.string(),
  system: SystemSchema,
  codebase: CodebaseSchema,
  session: SessionSchema,
  collection_errors: z.array(z.string()),
});

export type Diagnostics = z.infer<typeof DiagnosticsSchema>;

// ── Redaction ──────────────────────────────────────────────────────────

/**
 * Replace the user's home directory (and /Users/<name> style paths) with
 * a tilde so the payload doesn't leak usernames.
 */
export function redactHomePath(input: string): string {
  const home = homedir();
  let out = input;
  if (home) {
    out = out.split(home).join('~');
  }
  // Catch /Users/<name>, /home/<name>, and /root style prefixes that slip
  // past homedir() (e.g. paths collected from a different shell context).
  out = out.replace(
    /(?:\/Users\/|\/home\/)[^/\s:]+/g,
    (match) => match.split('/').slice(0, 2).join('/') + '/~',
  );
  return out;
}

// ── Helpers ────────────────────────────────────────────────────────────

function bucketize(count: number): string {
  for (const b of REPO_SIZE_BUCKETS) {
    if (count < b.max) return b.label;
  }
  return REPO_SIZE_BUCKETS[REPO_SIZE_BUCKETS.length - 1].label;
}

async function projectFileExists(
  installDir: string,
  file: ProjectFile,
): Promise<boolean> {
  try {
    await access(projectPath(installDir, file), fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function readProjectJson<T = unknown>(
  installDir: string,
  file: ProjectFile,
): Promise<T | null> {
  try {
    const raw = await readFile(projectPath(installDir, file), 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function isMonorepo(installDir: string): Promise<boolean> {
  const markers: ProjectFile[] = [
    'pnpm-workspace.yaml',
    'lerna.json',
    'turbo.json',
    'nx.json',
    'rush.json',
  ];
  for (const marker of markers) {
    if (await projectFileExists(installDir, marker)) return true;
  }
  // yarn/npm workspaces in package.json
  const pkg = await readProjectJson<{ workspaces?: unknown }>(
    installDir,
    'package.json',
  );
  return Boolean(pkg?.workspaces);
}

async function countTopLevelEntries(installDir: string): Promise<number> {
  try {
    const { readdir } = await import('fs/promises');
    const entries = await readdir(installDir, { withFileTypes: true });
    // Skip hidden entries and node_modules to get a "project complexity" signal
    return entries.filter(
      (e) => !e.name.startsWith('.') && e.name !== 'node_modules',
    ).length;
  } catch {
    return 0;
  }
}

async function hasTypescript(installDir: string): Promise<boolean> {
  if (await projectFileExists(installDir, 'tsconfig.json')) return true;
  const pkg = await readProjectJson<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>(installDir, 'package.json');
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  return 'typescript' in deps;
}

async function readAmplitudeSdkPackages(
  installDir: string,
): Promise<Array<{ name: string; version: string }>> {
  const pkg = await readProjectJson<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>(installDir, 'package.json');
  if (!pkg) return [];
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  return Object.entries(all)
    .filter(([name]) => name.startsWith('@amplitude/') || name === 'amplitude')
    .map(([name, version]) => ({ name, version: String(version) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function dependencyCounts(
  installDir: string,
): Promise<{ dependencies: number; dev_dependencies: number }> {
  const pkg = await readProjectJson<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>(installDir, 'package.json');
  return {
    dependencies: Object.keys(pkg?.dependencies ?? {}).length,
    dev_dependencies: Object.keys(pkg?.devDependencies ?? {}).length,
  };
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
  onTimeout: () => void,
): Promise<T> {
  let timerId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((resolve) => {
    timerId = setTimeout(() => {
      timerId = undefined;
      onTimeout();
      resolve(fallback);
    }, ms);
  });

  return Promise.race([
    promise.then((result) => {
      if (timerId !== undefined) {
        clearTimeout(timerId);
      }
      return result;
    }),
    timeoutPromise,
  ]);
}

// ── Public API ─────────────────────────────────────────────────────────

export interface CollectDiagnosticsOptions {
  session: Pick<
    WizardSession,
    | 'installDir'
    | 'integration'
    | 'region'
    | 'runPhase'
    | 'introConcluded'
    | 'setupConfirmed'
    | 'detectionComplete'
    | 'credentials'
  >;
  /** Wizard version string — usually from package.json via bin.ts. */
  wizardVersion: string;
  /** Pre-computed framework detection results (already run during the wizard). */
  detectedFrameworks?: Array<{ integration: string; detected: boolean }>;
  /** Budget for the collection. Defaults to 3s. */
  timeoutMs?: number;
}

/**
 * Gather a validated diagnostics payload. Never throws — on any failure
 * the offending field is set to its safe default and the error message
 * is pushed onto `collection_errors`.
 */
export async function collectDiagnostics(
  opts: CollectDiagnosticsOptions,
): Promise<Diagnostics> {
  const { session, wizardVersion, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const errors: string[] = [];
  const track = (label: string, err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`${label}: ${redactHomePath(msg)}`);
  };

  const safe = async <T>(
    label: string,
    fn: () => Promise<T>,
    fallback: T,
  ): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      track(label, err);
      return fallback;
    }
  };

  // Collection runs under a shared timeout. Individual probes run in
  // parallel so a slow one doesn't serialize the whole collection.
  const collection = Promise.all([
    safe(
      'package_managers',
      () => detectNodePackageManagers(session.installDir),
      {
        detected: [],
        primary: null,
        recommendation: '',
      } as PackageManagerInfo,
    ),
    safe('has_typescript', () => hasTypescript(session.installDir), false),
    safe(
      'has_package_json',
      () => projectFileExists(session.installDir, 'package.json'),
      false,
    ),
    safe(
      'amplitude_sdk_packages',
      () => readAmplitudeSdkPackages(session.installDir),
      [] as Array<{ name: string; version: string }>,
    ),
    safe('dependency_counts', () => dependencyCounts(session.installDir), {
      dependencies: 0,
      dev_dependencies: 0,
    }),
    safe('monorepo', () => isMonorepo(session.installDir), false),
    safe('repo_size', () => countTopLevelEntries(session.installDir), 0),
  ] as const);

  const [pm, hasTs, hasPkg, amplitudePkgs, depCounts, monorepo, topLevelCount] =
    await withTimeout(
      collection,
      timeoutMs,
      [
        {
          detected: [],
          primary: null,
          recommendation: '',
        } as PackageManagerInfo,
        false,
        false,
        [] as Array<{ name: string; version: string }>,
        { dependencies: 0, dev_dependencies: 0 },
        false,
        0,
      ] as const,
      () => errors.push(`collection: timed out after ${timeoutMs}ms`),
    );

  const detectedFrameworks = (opts.detectedFrameworks ?? [])
    .filter((f) => f.detected)
    .map((f) => f.integration);

  const payload: Diagnostics = {
    schema_version: DIAGNOSTICS_SCHEMA_VERSION,
    collected_at: new Date().toISOString(),
    system: {
      os: platform(),
      os_release: safeString(() => `${type()} ${release()}`),
      arch: arch(),
      node_version: process.version,
      shell: safeEnv('SHELL'),
      term_program: safeEnv('TERM_PROGRAM') ?? safeEnv('TERM'),
      locale: safeEnv('LANG') ?? safeEnv('LC_ALL'),
      wizard_version: wizardVersion,
    },
    codebase: {
      detected_frameworks: detectedFrameworks,
      package_managers: pm.detected.map((d) => d.name),
      has_typescript: hasTs,
      has_package_json: hasPkg,
      amplitude_sdk_packages: amplitudePkgs,
      dependency_counts: depCounts,
      monorepo,
      repo_size_bucket: bucketize(topLevelCount),
    },
    session: {
      run_phase: session.runPhase ?? RunPhase.Idle,
      integration: session.integration ?? null,
      region: session.region ?? null,
      intro_concluded: Boolean(session.introConcluded),
      setup_confirmed: Boolean(session.setupConfirmed),
      detection_complete: Boolean(session.detectionComplete),
      has_credentials: Boolean(session.credentials),
    },
    collection_errors: errors,
  };

  // Validate + strip unknown keys. Throw here would surface a bug in the
  // collector itself, not a runtime failure, so we let it bubble.
  return DiagnosticsSchema.parse(payload);
}

function safeString(fn: () => string): string | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function safeEnv(key: string): string | null {
  const v = process.env[key];
  return v && v.length > 0 ? v : null;
}
