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
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { redactString } from '../../src/lib/observability/redact.js';
import { captureFsSnapshot } from './fs-snapshot.js';
import { parseStream } from './parse-stream.js';
import type { Artifact, BuildResult, FsSnapshot, Scenario } from './types.js';

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
   * Eval-only Amplitude project API key. Only honored when the runner
   * resolves to the `api-key-bypass` auth mode (i.e. caller set
   * `EVALS_ALLOW_API_KEY_BYPASS=1`). Bypass mode skips the Amplitude
   * LLM gateway, so it can't catch gateway-specific regressions —
   * surface a warning when used.
   */
  apiKey?: string;
  /** Override the default 8-minute spawn timeout (ms). */
  timeoutMs?: number;
  /**
   * Override the wizard binary the runner spawns. Equivalent to
   * setting `WIZARD_BIN` on the runner process; the option takes
   * precedence so callers can drive multiple binaries from one
   * process without mutating env.
   *
   * When set, the runner skips the default `pnpm exec tsx bin.ts`
   * shape and spawns the override directly, e.g.
   * `npx @amplitude/wizard@latest` or `/path/to/built-cli`. The
   * `--agent --yes --install-dir <dir>` arg shape is appended by the
   * runner regardless.
   */
  wizardBin?: string;
}

/**
 * How `runLive` authenticates the wizard's LLM calls.
 *
 *   - `oauth-env`: read `WIZARD_OAUTH_TOKEN`/`_EXPIRES_AT`/`_ZONE` from
 *     the runner process env and forward them to the wizard child.
 *     Wizard-side wiring lands in a follow-up PR; until then this mode
 *     is reserved.
 *   - `api-key-bypass`: pass `--api-key` to the wizard. Routes LLM
 *     calls direct-to-Anthropic and skips the Amplitude LLM gateway,
 *     so it cannot catch gateway-specific failures (the Vertex schema
 *     noise / beta-header class). Opt in via `EVALS_ALLOW_API_KEY_BYPASS=1`.
 */
export type LiveAuthMode =
  | {
      kind: 'oauth-env';
      oauthToken: string;
      expiresAt?: string;
      zone?: string;
    }
  | {
      kind: 'api-key-bypass';
      apiKey: string;
    };

/**
 * Resolve the auth mode for a live run. Throws with a clear message
 * when neither path is configured — better than running in a default
 * mode and silently bypassing the gateway.
 */
export function resolveLiveAuthMode(
  options: InvokeWizardOptions,
): LiveAuthMode {
  const oauthToken = process.env.WIZARD_OAUTH_TOKEN;
  if (oauthToken) {
    return {
      kind: 'oauth-env',
      oauthToken,
      expiresAt: process.env.WIZARD_EXPIRES_AT,
      zone: process.env.WIZARD_ZONE,
    };
  }
  if (process.env.EVALS_ALLOW_API_KEY_BYPASS === '1' && options.apiKey) {
    return { kind: 'api-key-bypass', apiKey: options.apiKey };
  }
  throw new Error(
    'live mode requires authentication. Set WIZARD_OAUTH_TOKEN (preferred — routes through the Amplitude LLM gateway), or pass EVALS_ALLOW_API_KEY_BYPASS=1 with --api-key to opt into the gateway-bypass path. Bypass mode cannot catch gateway-specific regressions; use only when you understand the trade-off. Wizard-side reading of WIZARD_OAUTH_TOKEN/EXPIRES_AT/ZONE is a follow-up wiring PR.',
  );
}

/**
 * Build the spawn shape (`cmd` + base `args`) for the wizard child.
 *
 * Default path: `pnpm exec tsx bin.ts ...` against the developer
 * checkout. Set `WIZARD_BIN` (or pass `--wizard-bin <cmd>` to
 * `evals/bin/run-eval.ts`, which forwards to `wizardBin`) to spawn an
 * arbitrary command instead — e.g. `npx @amplitude/wizard@latest` or a
 * built tarball path. This is what unlocks Ring 3 packaging coverage:
 * we run the same scenarios against the published artifact, not just
 * the source tree.
 *
 * When `wizardBin` is set the runner does NOT prepend `pnpm exec
 * tsx bin.ts`; the caller is expected to pass a single command (e.g.
 * `"npx"` plus its arg list, or a path to a built CLI). The `--agent
 * --yes --install-dir <dir>` shape is appended by the runner — those
 * are framework invariants, not packaging concerns.
 */
export function resolveWizardSpawn(options: InvokeWizardOptions): {
  cmd: string;
  baseArgs: string[];
} {
  const override = options.wizardBin ?? process.env.WIZARD_BIN;
  if (override && override.trim().length > 0) {
    // Tokenize on whitespace — good enough for the supported shapes
    // (`npx @amplitude/wizard@latest`, `node /path/to/cli.js`,
    // `/path/to/built-cli`). Anything that needs shell quoting should
    // be wrapped in a script and pointed at via WIZARD_BIN.
    const parts = override.trim().split(/\s+/);
    return { cmd: parts[0], baseArgs: parts.slice(1) };
  }
  return { cmd: 'pnpm', baseArgs: ['exec', 'tsx', 'bin.ts'] };
}

/**
 * Mint a per-run working directory under `os.tmpdir()` keyed by the
 * runId. Two parallel scenario runs would collide on the old
 * `<scenarioDir>/working/` single-slot path — a tmpdir-scoped subdir
 * keeps each run isolated and lets cleanup stay best-effort.
 */
function mintWorkingDir(runId: string): string {
  return join(tmpdir(), 'amplitude-wizard-evals', runId);
}

/**
 * Result of a runner invocation. Carries the artifact plus the
 * absolute `workingDir` the run wrote into so callers (the orchestrator
 * + scorers) can read file content from one source. Both `runLive` and
 * `runReplay` return the same shape so `run-eval.ts` doesn't branch on
 * source when wiring the workingDir into the scorer stack.
 */
export interface RunnerResult {
  artifact: Artifact;
  /** Absolute path to the directory scorers should read files from. */
  workingDir: string;
  /**
   * Tear down any per-run resources the runner created. The caller
   * (`run-eval.ts`) MUST invoke this AFTER scoring completes — the
   * runner deliberately does not clean up `workingDir` before returning
   * so scorers can read files from it via `EVALS_WORKING_DIR`.
   *
   * - `runLive`: removes the tmpdir-scoped working tree. Best-effort —
   *   `mintWorkingDir` is keyed on a fresh runId per call, so a leak
   *   only costs tmpdir space and the next run's own pre-clean is a
   *   backstop.
   * - `runReplay`: no-op. The golden working dir is a permanent
   *   fixture; deleting it would corrupt the scenario.
   *
   * Idempotent: calling more than once is safe.
   */
  cleanup: () => void;
}

/**
 * Spawn the wizard against a fresh copy of `pristine/` and capture an
 * artifact. Tears down the working tree afterwards regardless of
 * success / failure so a crash mid-run doesn't pollute the next run.
 */
export async function runLive(
  options: InvokeWizardOptions,
): Promise<RunnerResult> {
  const { scenario, scenarioDir, repoRoot } = options;
  const startedAt = new Date().toISOString();

  const pristineDir = join(scenarioDir, 'pristine');
  const runId = newRunId();
  const workingDir = mintWorkingDir(runId);

  if (!existsSync(pristineDir)) {
    throw new Error(
      `pristine directory missing: ${pristineDir} — fixture is broken`,
    );
  }

  // Always start from a clean working dir. The runId is fresh so a
  // collision is theoretically impossible, but be defensive: a stale
  // dir from a prior crash with the same runId (e.g. clock-rollback
  // tests) would otherwise pollute this run.
  if (existsSync(workingDir)) rmSync(workingDir, { recursive: true });
  mkdirSync(workingDir, { recursive: true });
  cpSync(pristineDir, workingDir, { recursive: true });

  const auth = resolveLiveAuthMode(options);

  const { cmd, baseArgs } = resolveWizardSpawn(options);
  const args = [...baseArgs, '--agent', '--yes', '--install-dir', workingDir];
  // useDetection defaults to `true` (pass `--integration`). Set
  // `false` on a scenario to drop the hint and grade the wizard's
  // detection pipeline against `integrationHint` as ground truth.
  if (scenario.useDetection) {
    args.push('--integration', scenario.integrationHint);
  }
  if (auth.kind === 'api-key-bypass') {
    args.push('--api-key', auth.apiKey);
  }

  const env = { ...process.env };
  // Ensure the wizard takes the agent code path even if the parent
  // process happens to have set TUI-leaning env.
  env.AMPLITUDE_WIZARD_AGENT = '1';
  if (auth.kind === 'oauth-env') {
    // Forward gateway-auth env to the wizard child. Wizard-side
    // reading of these env vars is a follow-up PR; until then a run
    // here will hit the OAuth flow inside the wizard and fail loudly.
    // That's deliberate — preferable to silently routing direct-to-
    // Anthropic and pretending we evaluated the gateway path.
    env.WIZARD_OAUTH_TOKEN = auth.oauthToken;
    if (auth.expiresAt) env.WIZARD_EXPIRES_AT = auth.expiresAt;
    if (auth.zone) env.WIZARD_ZONE = auth.zone;
  }

  const { stdout, stderr, exitCode } = await spawnAndCapture(
    cmd,
    args,
    { cwd: repoRoot, env },
    options.timeoutMs ?? 8 * 60_000,
  );

  const finishedAt = new Date().toISOString();
  const parsed = parseStream(stdout);
  const fsSnapshot = captureFsSnapshot(pristineDir, workingDir);

  // Cleanup is deferred to `RunnerResult.cleanup` — the orchestrator
  // (`run-eval.ts`) calls it after scoring runs, so scorers can still
  // read files from `workingDir` via `EVALS_WORKING_DIR`. Removing the
  // tree before returning would hard-fail every Layer 0 scorer that
  // reads `package.json` or scans the source tree.
  return {
    artifact: {
      runId,
      scenario: scenario.name,
      ring: scenario.ring,
      startedAt,
      finishedAt,
      exitCode,
      runLog: parsed.events,
      fsSnapshot,
      stderr,
      source: 'live',
    },
    workingDir,
    cleanup: () => {
      try {
        rmSync(workingDir, { recursive: true, force: true });
      } catch {
        // ignore — diagnostics will surface a stale dir
      }
    },
  };
}

/**
 * Wrapper around `child_process.spawn` that captures stdout AND
 * stderr to strings and returns the exit code.
 *
 * Stderr is captured — not piped through to the parent terminal —
 * because letting it land in CI logs is a leak surface for any
 * unredacted secrets the wizard might emit (timeouts, stack traces,
 * gateway error bodies). We pass the captured buffer through
 * `redactString` from `src/lib/observability/redact.ts` before storing
 * it on the artifact. A Layer 0 scorer
 * (`no-secret-in-stderr`) verifies redaction fully covered any
 * secret-shaped content.
 */
function spawnAndCapture(
  cmd: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
    }
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
      // Apply redaction to the FULL captured buffer once at the end —
      // a chunk-boundary-spanning token is the regression that
      // chunk-level redaction misses.
      resolve({ stdout, stderr: redactString(stderr), exitCode: code ?? 1 });
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
export function runReplay(options: ReplayOptions): RunnerResult {
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

  // Optional `golden/stderr.txt` lets fixtures pin a stderr stream
  // for the secret-in-stderr scorer to grade against. Default to
  // empty string when absent — most goldens don't carry one yet.
  const stderrPath = join(goldenDir, 'stderr.txt');
  const stderr = existsSync(stderrPath) ? readFileSync(stderrPath, 'utf8') : '';

  // Optional `golden/build-result.json` pins a pre-recorded
  // {@link BuildResult} for the L3 scorer. Absence is fine — L3 then
  // skip-passes with weight 0 (no signal, no penalty).
  const buildResultPath = join(goldenDir, 'build-result.json');
  let buildResult: BuildResult | undefined;
  if (existsSync(buildResultPath)) {
    buildResult = JSON.parse(
      readFileSync(buildResultPath, 'utf8'),
    ) as BuildResult;
  }

  const parsed = parseStream(ndjson);
  const fsSnapshot: FsSnapshot = captureFsSnapshot(pristineDir, goldenWorking);

  return {
    artifact: {
      runId: newRunId(),
      scenario: scenario.name,
      ring: scenario.ring,
      startedAt,
      finishedAt: new Date().toISOString(),
      exitCode,
      runLog: parsed.events,
      fsSnapshot,
      stderr,
      buildResult,
      source: 'golden',
    },
    // Replay reads file content from the pre-recorded golden working
    // dir — that's the snapshot scorers should grade against.
    workingDir: goldenWorking,
    // No-op: the golden working dir is a permanent fixture, not a
    // per-run tmpdir. Deleting it would corrupt the scenario.
    cleanup: () => {},
  };
}
