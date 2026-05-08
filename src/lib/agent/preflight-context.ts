/**
 * Pre-flight context block injected at the top of the agent's first user
 * message.
 *
 * The wizard already knows nearly everything the agent reflexively probes
 * for at cold-start: the install directory, the detected framework + its
 * version, whether the project uses TypeScript, the lockfile-based package
 * manager, the chosen Amplitude org/project/region, the project API key,
 * which env files exist, and which Amplitude env keys are already present
 * (without exposing values). Re-discovering all of this through MCP /
 * Bash / Glob calls burns ~30s of cold-start, and — worse — gives the
 * model room to hallucinate (wrong workspace syntax for monorepos, an
 * appId picked from `get_context.appsByCategory`, etc.) or trigger
 * cascading bash-deny loops.
 *
 * This helper renders a deterministic Markdown block so the agent can
 * skip the discovery turn entirely. The discovery tools stay registered;
 * the agent is only told not to call them at start. If something the
 * user just changed contradicts the block, the agent can still verify
 * with `check_env_keys` / `detect_package_manager`.
 *
 * What the block does NOT include:
 *
 *   - Env values (only key presence)
 *   - OAuth / access tokens
 *   - The Amplitude project API key (already in the per-turn integration
 *     prompt; duplicating it here would just bloat the cached envelope)
 *
 * Pure function — accepts a plain `PreflightContextInput` and returns a
 * string. No I/O happens here aside from a single `fs.existsSync` per
 * candidate env basename. Tests can call it with a tmpdir + synthetic
 * inputs.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parseEnvKeys } from '../wizard-tools.js';
import {
  detectProjectSize,
  resolveThresholds,
  shouldUseJitMode,
  type ProjectSizeReport,
} from './project-size.js';

import type { Integration } from '../constants.js';
import type { PackageManagerInfo } from '../package-manager-detection-types.js';

/**
 * Env file basenames the wizard scans for existing AMPLITUDE_* keys.
 * Mirrors the set of files an agent would otherwise fan out `check_env_keys`
 * calls against during cold-start discovery.
 */
const ENV_FILE_CANDIDATES: ReadonlyArray<string> = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
  '.env.production',
  '.env.production.local',
  '.env.example',
];

/**
 * Env key prefixes the wizard reports presence for. Keeping this allowlist
 * narrow avoids leaking the names of unrelated app secrets into the cached
 * system-prompt block — we only echo keys that look Amplitude-related.
 */
const REPORTED_ENV_KEY_PREFIXES: ReadonlyArray<string> = [
  'AMPLITUDE_',
  'NEXT_PUBLIC_AMPLITUDE_',
  'VITE_AMPLITUDE_',
  'REACT_APP_AMPLITUDE_',
  'PUBLIC_AMPLITUDE_',
  'NUXT_PUBLIC_AMPLITUDE_',
  'EXPO_PUBLIC_AMPLITUDE_',
];

export interface PreflightContextInput {
  /** Absolute install directory of the user's project. */
  installDir: string;
  /** Resolved framework integration id (or null when detection failed). */
  integration: Integration | null;
  /** Human-readable framework label, e.g. "Next.js 15.3" or "Django with Wagtail CMS". */
  detectedFrameworkLabel: string | null;
  /** Framework version string ("latest" when unknown). */
  frameworkVersion: string | null;
  /** Whether the project has a `tsconfig.json` (per detection). */
  typescript: boolean;
  /** Lockfile-based package manager scan result, or null when unavailable. */
  packageManagerInfo: PackageManagerInfo | null;
  /** Authenticated user's email, when known. */
  userEmail: string | null;
  /** Org / project picker selections (string IDs). */
  selectedOrgId: string | null;
  selectedOrgName: string | null;
  selectedProjectId: string | null;
  selectedProjectName: string | null;
  /** Amplitude environment NAME (e.g. "Production"). */
  selectedEnvName: string | null;
  /** Resolved data-center region the run will write to. */
  cloudRegion: 'us' | 'eu';
  /** True when the wizard already wrote `.amplitude/project-binding.json`. */
  projectBound: boolean;
  /** Raw arbitrary k/v from per-framework setup screens. Stringified verbatim. */
  frameworkContext?: Record<string, unknown>;
  /**
   * Optional pre-computed project-size report. When present, it gates the
   * pre-flight block: large projects (file count > threshold OR event count
   * > threshold) get a short JIT-exploration prompt instead of the full
   * Markdown summary, which would otherwise burn attention budget the
   * agent should be spending on `read_file` / `grep` exploration.
   *
   * When absent, `buildPreflightContext` runs the detection itself under
   * the default 5s wall-clock cap. Tests and the agent-runner wiring both
   * pre-compute the report so the call site can log the numbers.
   */
  projectSize?: ProjectSizeReport;
  /**
   * Optional override for `process.env`. Tests pass a synthetic env so
   * threshold tuning via `AMPLITUDE_WIZARD_PREFLIGHT_FILE_THRESHOLD` /
   * `AMPLITUDE_WIZARD_PREFLIGHT_EVENT_THRESHOLD` can be exercised without
   * mutating real-world environment.
   */
  env?: NodeJS.ProcessEnv;
}

interface EnvFileSnapshot {
  basename: string;
  amplitudeKeys: string[];
}

/** Find env files at the install root and report Amplitude-related keys present. */
function scanEnvFiles(installDir: string): EnvFileSnapshot[] {
  const snapshots: EnvFileSnapshot[] = [];
  for (const basename of ENV_FILE_CANDIDATES) {
    const filePath = path.join(installDir, basename);
    let content: string;
    try {
      if (!fs.existsSync(filePath)) continue;
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      // Unreadable env file (permissions, race) — skip silently. The agent
      // can fall back to `check_env_keys` if it needs to verify.
      continue;
    }
    const keys = parseEnvKeys(content);
    const amplitudeKeys: string[] = [];
    for (const key of keys) {
      if (REPORTED_ENV_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        amplitudeKeys.push(key);
      }
    }
    amplitudeKeys.sort();
    snapshots.push({ basename, amplitudeKeys });
  }
  return snapshots;
}

/** Render a single line of the form "- key: value" or "- key: ?" for unknowns. */
function line(key: string, value: string | number | boolean | null): string {
  if (value === null || value === undefined || value === '') {
    return `- ${key}: ?`;
  }
  if (typeof value === 'boolean') {
    return `- ${key}: ${value ? 'yes' : 'no'}`;
  }
  return `- ${key}: ${value}`;
}

function renderProject(input: PreflightContextInput): string {
  const lines: string[] = ['## Project'];
  lines.push(line('cwd', input.installDir));

  let frameworkValue: string | null = null;
  if (input.detectedFrameworkLabel) {
    frameworkValue = input.detectedFrameworkLabel;
    if (input.integration) frameworkValue += ` (id: ${input.integration})`;
  } else if (input.integration) {
    frameworkValue = String(input.integration);
  }
  lines.push(line('framework', frameworkValue));

  if (input.frameworkVersion && input.frameworkVersion !== 'latest') {
    lines.push(line('framework version', input.frameworkVersion));
  }

  // Package manager — primary lockfile + the install command the agent
  // would otherwise have to fetch via detect_package_manager.
  const pm = input.packageManagerInfo;
  if (pm && pm.primary) {
    lines.push(
      line(
        'package manager',
        `${pm.primary.label} (install: ${pm.primary.installCommand})`,
      ),
    );
    if (pm.detected.length > 1) {
      // Compare by `label` rather than reference — callers (especially
      // tests) often pass `primary` as a sibling object literal, not a
      // shared reference into `detected`.
      const others = pm.detected
        .filter((d) => d.label !== pm.primary?.label)
        .map((d) => d.label);
      if (others.length > 0) {
        lines.push(line('other lockfiles present', others.join(', ')));
      }
    }
  } else {
    lines.push(line('package manager', '?'));
  }

  lines.push(line('TypeScript', input.typescript));

  // Surface notable framework-context answers verbatim — these come from
  // SetupScreen and frequently include monorepo / app-router / project-type
  // disambiguators the agent would otherwise probe for. We stringify defensively
  // so an unexpected value type can't blow up the prompt builder.
  if (input.frameworkContext) {
    const entries = Object.entries(input.frameworkContext).filter(
      ([, v]) => v !== null && v !== undefined && v !== '',
    );
    if (entries.length > 0) {
      lines.push('- framework context:');
      for (const [k, v] of entries) {
        let serialized: string;
        try {
          serialized = typeof v === 'string' ? v : JSON.stringify(v);
        } catch {
          serialized = '[unserializable]';
        }
        lines.push(`  - ${k}: ${serialized}`);
      }
    }
  }

  return lines.join('\n');
}

function renderAmplitude(input: PreflightContextInput): string {
  const lines: string[] = ['## Amplitude state'];
  // `userEmail: null` means the wizard hasn't observed an authenticated
  // session — don't tell the agent the user is signed in. The taxonomy
  // / dashboard skills branch on this and would silently skip the
  // sign-in prompt if we reported "signed in" without an email.
  const auth = input.userEmail ? `signed in (${input.userEmail})` : '?';
  lines.push(line('auth', auth));
  if (input.selectedOrgName || input.selectedOrgId) {
    const value = input.selectedOrgName
      ? `${input.selectedOrgName}${
          input.selectedOrgId ? ` (id: ${input.selectedOrgId})` : ''
        }`
      : `id: ${input.selectedOrgId}`;
    lines.push(line('org', value));
  } else {
    lines.push(line('org', '?'));
  }
  if (input.selectedProjectName || input.selectedProjectId) {
    const value = input.selectedProjectName
      ? `${input.selectedProjectName}${
          input.selectedProjectId ? ` (id: ${input.selectedProjectId})` : ''
        }`
      : `id: ${input.selectedProjectId}`;
    lines.push(line('project', value));
  } else {
    lines.push(line('project', '?'));
  }
  if (input.selectedEnvName) {
    lines.push(line('environment', input.selectedEnvName));
  }
  lines.push(line('region', input.cloudRegion));
  lines.push(line('bound', input.projectBound));
  return lines.join('\n');
}

function renderEnvironment(installDir: string): string {
  const snapshots = scanEnvFiles(installDir);
  const lines: string[] = ['## Environment'];
  if (snapshots.length === 0) {
    lines.push(line('env files present', 'none'));
    lines.push(line('existing AMPLITUDE_* keys', 'none'));
    return lines.join('\n');
  }
  const present = snapshots.map((s) => s.basename).join(', ');
  lines.push(line('env files present', present));

  const allAmplitudeKeys = new Map<string, string[]>();
  for (const snapshot of snapshots) {
    for (const key of snapshot.amplitudeKeys) {
      const where = allAmplitudeKeys.get(key) ?? [];
      where.push(snapshot.basename);
      allAmplitudeKeys.set(key, where);
    }
  }
  if (allAmplitudeKeys.size === 0) {
    lines.push(line('existing AMPLITUDE_* keys', 'none'));
  } else {
    lines.push('- existing AMPLITUDE_* keys:');
    for (const [key, files] of [...allAmplitudeKeys.entries()].sort()) {
      lines.push(`  - ${key}: present in ${files.join(', ')}`);
    }
  }
  return lines.join('\n');
}

/**
 * Render the just-in-time exploration block used for medium-and-up
 * codebases. The structured pre-flight summary is intentionally suppressed
 * here — Anthropic's guidance is that the model spends attention better
 * on `read_file` / `grep` / discovery tools as it actually needs the
 * information. We still emit a stable H1 header and a short "you are in
 * a large project" preamble so the agent has something concrete to anchor
 * on instead of silently falling back to its own probing pattern.
 */
function buildJitContextBlock(
  input: PreflightContextInput,
  size: ProjectSizeReport,
): string {
  const header = '# Pre-flight context (large project — load on demand)';
  const counts = describeProjectSize(size);
  const project = renderProject(input);
  const amplitude = renderAmplitude(input);
  const guidance =
    `> This project is large (${counts}). Use \`read_file\`, \`grep\`, ` +
    "and the wizard's discovery tools (`detect_package_manager`, " +
    '`check_env_keys`, `Glob`) **just-in-time** as you need information — ' +
    "don't try to load everything upfront. Loading the full project map " +
    "into the prompt would burn attention budget that's better spent on " +
    'the specific files you actually have to edit. The Project / Amplitude ' +
    'blocks above cover the values the wizard has cached; the rest of the ' +
    'codebase is yours to explore on demand.';
  return [header, project, amplitude, guidance].join('\n\n') + '\n';
}

function describeProjectSize(size: ProjectSizeReport): string {
  const parts: string[] = [];
  // `timedOut` (wall-clock cap) and `capHit` (file-count cap) both yield
  // a partial count — annotate accordingly so the LLM knows the number is
  // a lower bound. `capHit` is the more common case in practice.
  if (size.timedOut || size.capHit) {
    parts.push(`${size.fileCount}+ files (scan capped)`);
  } else {
    parts.push(`${size.fileCount} files`);
  }
  if (size.eventCount > 0) {
    parts.push(`${size.eventCount} confirmed events`);
  }
  return parts.join(' / ');
}

/**
 * Result of `buildPreflightContext`. Returns the rendered Markdown plus
 * the gate decision so callers (most notably `agent-runner.ts`) can log
 * the authoritative mode without recomputing thresholds — that previously
 * created a divergence risk between the gate and the diagnostic line.
 */
export interface PreflightContextResult {
  /** Markdown block to prepend to the integration prompt. */
  prompt: string;
  /** True when the JIT mode block was rendered (large project). */
  jitMode: boolean;
  /** Project-size report used to make the gate decision. */
  projectSize: ProjectSizeReport;
  /** Resolved thresholds from env vars (or defaults). */
  thresholds: { fileThreshold: number; eventThreshold: number };
}

/**
 * Build the pre-flight context block. Always returns a non-empty Markdown
 * string with a stable H1 header; callers can prepend it to the integration
 * prompt unconditionally.
 *
 * Two modes:
 *
 *  1. **Full pre-flight** (default for small / unknown-size projects).
 *     Renders Project / Amplitude state / Environment sections so the
 *     agent skips the cold-start probe entirely. This is the PR #600
 *     behavior.
 *
 *  2. **JIT mode** (medium-and-up projects, gated on file/event count).
 *     Renders the Project / Amplitude blocks but replaces the Environment
 *     dump and the "do not probe" footer with a short instruction telling
 *     the agent to load context on demand. Trades the cold-start probe
 *     win for attention-budget headroom on large codebases.
 *
 * The mode decision uses `input.projectSize` if supplied; otherwise the
 * helper runs `detectProjectSize` itself with the default 5s cap.
 */
export async function buildPreflightContext(
  input: PreflightContextInput,
): Promise<PreflightContextResult> {
  const size = input.projectSize ?? (await detectProjectSize(input.installDir));
  const thresholds = resolveThresholds(input.env ?? process.env);
  const jitMode = shouldUseJitMode(size, thresholds);

  if (jitMode) {
    return {
      prompt: buildJitContextBlock(input, size),
      jitMode: true,
      projectSize: size,
      thresholds,
    };
  }

  const sections = [
    renderProject(input),
    renderAmplitude(input),
    renderEnvironment(input.installDir),
  ];
  const header =
    '# Pre-flight context (you have these answers; do NOT re-probe at start)';
  const footer =
    '> The wizard already discovered the values above. Do NOT call ' +
    '`detect_package_manager`, `check_env_keys`, or other discovery tools ' +
    'on the very first turn just to re-derive them. Those tools remain ' +
    'available later if you need to verify a value the user just changed.';
  return {
    prompt: [header, ...sections, footer].join('\n\n') + '\n',
    jitMode: false,
    projectSize: size,
    thresholds,
  };
}
