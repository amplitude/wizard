/**
 * Wizard invoker.
 *
 * Two paths to producing an {@link Artifact}:
 *
 *   1. **Live** — spawn `amplitude-wizard --agent --yes` against a
 *      working copy of the fixture, capture NDJSON from stdout, and
 *      walk the working tree afterwards. This is the path that
 *      catches real regressions.
 *
 *   2. **Golden replay** — load a pre-recorded NDJSON stream and a
 *      pre-recorded fs snapshot from disk. Useful when the wizard
 *      can't run end-to-end without a real OAuth seed (Week 1 reality:
 *      the eval-only Amplitude project doesn't exist yet, so we cannot
 *      run a true live integration in CI). Replay lets scorers exercise
 *      against a realistic artifact and prove the framework is correct
 *      independently of ingestion.
 *
 * Both paths produce the same `Artifact` shape so scorers don't need to
 * branch on source. The artifact carries a `source` field (`live` /
 * `golden`) so triage reports can flag replay runs explicitly.
 */

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { captureFsSnapshot } from './fs-snapshot.js';
import { parseStream } from './parse-stream.js';
import type { Artifact, FsSnapshot, Scenario } from './types.js';

/**
 * Generate a short, sortable run ID. Prefer crypto.randomUUID over a
 * full ULID dep — Week 1 doesn't need lexicographic time-sortability.
 */
function newRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export interface InvokeWizardOptions {
  scenario: Scenario;
  /** Absolute path to the scenario directory containing pristine/. */
  scenarioDir: string;
  /** Absolute path to the wizard repo root (for spawning the CLI). */
  repoRoot: string;
  /**
   * Eval-only Amplitude API key. Only used in `live` mode. The runner
   * never writes this to the artifact — it's passed to the wizard via
   * env or a flag, and a Layer 0 scorer asserts the key never appears
   * in the diff.
   */
  apiKey?: string;
  /** Override the default 8-minute spawn timeout (ms). */
  timeoutMs?: number;
}

/**
 * Spawn the wizard against a fresh copy of `pristine/` and capture an
 * artifact. Tears down the working tree afterwards regardless of
 * success / failure so a crash mid-run doesn't pollute the next run.
 */
export async function runLive(options: InvokeWizardOptions): Promise<Artifact> {
  const { scenario, scenarioDir, repoRoot } = options;
  const startedAt = new Date().toISOString();

  const pristineDir = join(scenarioDir, 'pristine');
  const workingDir = join(scenarioDir, 'working');

  if (!existsSync(pristineDir)) {
    throw new Error(
      `pristine directory missing: ${pristineDir} — fixture is broken`,
    );
  }

  // Always start from a clean working dir. The spec calls for
  // teardown at run-end, but we also clean at run-start to be
  // resilient to a previous crash.
  if (existsSync(workingDir)) rmSync(workingDir, { recursive: true });
  mkdirSync(workingDir, { recursive: true });
  cpSync(pristineDir, workingDir, { recursive: true });

  const args = [
    'exec',
    'tsx',
    'bin.ts',
    '--agent',
    '--yes',
    '--install-dir',
    workingDir,
    '--integration',
    scenario.integrationHint,
  ];
  if (options.apiKey) {
    args.push('--api-key', options.apiKey);
  }

  const env = { ...process.env };
  // Ensure the wizard takes the agent code path even if the parent
  // process happens to have set TUI-leaning env.
  env.AMPLITUDE_WIZARD_AGENT = '1';

  const { stdout, exitCode } = await spawnAndCapture(
    'pnpm',
    args,
    { cwd: repoRoot, env },
    options.timeoutMs ?? 8 * 60_000,
  );

  const finishedAt = new Date().toISOString();
  const parsed = parseStream(stdout);
  const fsSnapshot = captureFsSnapshot(pristineDir, workingDir);

  // Best-effort teardown. If this fails the next run will still
  // start by removing `working/`.
  try {
    rmSync(workingDir, { recursive: true });
  } catch {
    // ignore — diagnostics will surface a stale dir
  }

  return {
    runId: newRunId(),
    scenario: scenario.name,
    ring: scenario.ring,
    startedAt,
    finishedAt,
    exitCode,
    runLog: parsed.events,
    fsSnapshot,
    source: 'live',
  };
}

/**
 * Wrapper around `child_process.spawn` that captures stdout to a
 * string and returns the exit code. Stderr is intentionally
 * discarded: AgentUI redacts secrets only from stdout, so reading
 * stderr into the artifact would risk leaking unredacted data through
 * the scoring path. Stderr is still useful for live debugging — pipe
 * it through to the parent terminal.
 */
function spawnAndCapture(
  cmd: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
  timeoutMs: number,
): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`wizard timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ stdout, exitCode: code ?? 1 });
    });
  });
}

export interface ReplayOptions {
  scenario: Scenario;
  scenarioDir: string;
}

/**
 * Load a pre-recorded run from `<scenarioDir>/golden/`. Expects:
 *
 *   - `golden/run.ndjson` — the captured NDJSON stream.
 *   - `golden/exit-code.txt` — single integer.
 *   - `golden/working/` — snapshot of what the wizard would have
 *     written, content-equivalent to a real run's working tree.
 *
 * Replay is a Week-1 affordance, not a permanent test fixture.
 * Once the eval-only Amplitude project exists, scenarios should
 * rely on `runLive` and replay should be reserved for offline scorer
 * development.
 */
export function runReplay(options: ReplayOptions): Artifact {
  const { scenario, scenarioDir } = options;
  const startedAt = new Date().toISOString();

  const goldenDir = join(scenarioDir, 'golden');
  const ndjsonPath = join(goldenDir, 'run.ndjson');
  const exitCodePath = join(goldenDir, 'exit-code.txt');
  const goldenWorking = join(goldenDir, 'working');
  const pristineDir = join(scenarioDir, 'pristine');

  for (const path of [ndjsonPath, exitCodePath, goldenWorking, pristineDir]) {
    if (!existsSync(path)) {
      throw new Error(`replay artifact missing: ${path}`);
    }
  }

  const ndjson = readFileSync(ndjsonPath, 'utf8');
  const exitCode = Number.parseInt(
    readFileSync(exitCodePath, 'utf8').trim(),
    10,
  );
  if (!Number.isInteger(exitCode)) {
    throw new Error(`golden exit-code.txt is not an integer`);
  }

  const parsed = parseStream(ndjson);
  const fsSnapshot: FsSnapshot = captureFsSnapshot(pristineDir, goldenWorking);

  return {
    runId: newRunId(),
    scenario: scenario.name,
    ring: scenario.ring,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode,
    runLog: parsed.events,
    fsSnapshot,
    source: 'golden',
  };
}
