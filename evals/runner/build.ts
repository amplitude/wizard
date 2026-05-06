/**
 * Layer 3 build runner.
 *
 * Runs `pnpm install` followed by the scenario's `buildCommand`
 * inside the post-wizard working tree, captures stderr + exit code,
 * and surfaces a {@link BuildResult} the L3 scorer grades.
 *
 * Stderr passes through `redactString` (same redactor as the
 * wizard-stdout path in `invoke-wizard.ts`) at flush time before
 * landing on the artifact — keeps secrets out of CI logs and the
 * build report.
 */

import { spawn } from 'node:child_process';

import { redactString } from '../../src/lib/observability/redact.js';
import type { BuildResult } from './types.js';

/** Last N lines of a string, joined with `\n`. */
function tail(text: string, lines = 80): string {
  const split = text.split(/\r?\n/);
  return split.slice(-lines).join('\n');
}

interface SpawnOutcome {
  exitCode: number;
  stderr: string;
}

function spawnCaptureStderr(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<SpawnOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`build step timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ stderr, exitCode: code ?? 1 });
    });
  });
}

export interface RunBuildOptions {
  /** Absolute path to the post-wizard working tree. */
  workingDir: string;
  /** From `scenario.buildCommand` — e.g. `['pnpm', 'build']`. */
  buildCommand: string[];
  /** Override the install step (default `['pnpm', 'install', '--frozen-lockfile=false']`). */
  installCommand?: string[];
  /** Per-step timeout in ms; total budget is 2 × this. Default 5 min. */
  timeoutMs?: number;
}

/**
 * Run install + build, return a {@link BuildResult}. Never throws
 * on a non-zero exit — the result carries the exit code so the L3
 * scorer can grade. Throws only on timeouts and spawn errors (those
 * are runner-level failures, not scoring outcomes).
 */
export async function runBuild(options: RunBuildOptions): Promise<BuildResult> {
  const { workingDir, buildCommand } = options;
  const installCommand = options.installCommand ?? [
    'pnpm',
    'install',
    '--frozen-lockfile=false',
    '--prefer-offline',
  ];
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const start = Date.now();

  // 1) Install. If install fails the build is meaningless; surface
  // the install exit code separately so triagers can tell the two
  // failure classes apart.
  const installOutcome = await spawnCaptureStderr(
    installCommand[0],
    installCommand.slice(1),
    workingDir,
    timeoutMs,
  );
  if (installOutcome.exitCode !== 0) {
    return {
      exitCode: installOutcome.exitCode,
      installExitCode: installOutcome.exitCode,
      stderrTail: redactString(tail(installOutcome.stderr)),
      durationMs: Date.now() - start,
    };
  }

  // 2) Build. Pass exit code through verbatim — the scorer decides
  // what's a fail. (Some build commands return non-zero on warnings;
  // the spec treats only "didn't compile" as a fail, not warn-noise.)
  const buildOutcome = await spawnCaptureStderr(
    buildCommand[0],
    buildCommand.slice(1),
    workingDir,
    timeoutMs,
  );
  return {
    exitCode: buildOutcome.exitCode,
    installExitCode: 0,
    stderrTail: redactString(tail(buildOutcome.stderr)),
    durationMs: Date.now() - start,
  };
}
