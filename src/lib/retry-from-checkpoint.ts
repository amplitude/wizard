/**
 * Retry-from-checkpoint — relaunch the wizard from the current install dir
 * after an error or cancel outro, letting the new child process pick up the
 * existing checkpoint at `~/.amplitude/wizard/runs/<sha256(installDir)>/checkpoint.json`.
 *
 * The user-facing flow:
 *   1. Wizard hits an error / user cancels mid-run.
 *   2. OutroScreen renders the error/cancel view with a "Press R to retry" hint.
 *   3. User presses R. We spawn a detached-but-foreground child node process
 *      that re-runs the wizard binary with the same args (minus `--api-key`,
 *      and with `--install-dir` pinned to the session's installDir).
 *   4. The child reads the checkpoint and resumes from the post-detection
 *      step, skipping intro / region / org-project / framework selection.
 *   5. We wait for the child to exit and propagate its exit code.
 *
 * Why spawn rather than re-run in-process? The wizard's state is sprawled
 * across module-level singletons (UI registry, agent abort, OAuth client,
 * MCP server, etc.). A clean process restart is simpler and guaranteed
 * correct than trying to re-initialize all that state.
 *
 * Critical: do NOT call `process.exit` while the child is still running —
 * that would kill the inherited stdio. Wait for `child.on('exit', …)`.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { analytics } from '../utils/analytics';
import { getCacheRoot } from '../utils/storage-paths';
import type { WizardSession } from './wizard-session';

/**
 * Args that should never survive the retry. `--api-key` short-circuits the
 * normal credential resolution (and therefore checkpoint resume), so it must
 * be pruned. `--install-dir` is replaced with the session's installDir
 * explicitly so the retry resumes the right project even if cwd changed.
 */
const PRUNED_ARG_PREFIXES = ['--api-key', '--install-dir'] as const;

/**
 * Strip prefixed args (and their following value, if separated by space)
 * from an argv slice. Handles both `--foo=bar` and `--foo bar` forms.
 */
export function pruneArgs(
  args: readonly string[],
  prefixes: readonly string[] = PRUNED_ARG_PREFIXES,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const matchedPrefix = prefixes.find(
      (p) => arg === p || arg.startsWith(`${p}=`),
    );
    if (matchedPrefix) {
      // If form is `--foo bar` (no `=`), also skip the next token (value).
      if (arg === matchedPrefix && i + 1 < args.length) {
        i += 1;
      }
      continue;
    }
    out.push(arg);
  }
  return out;
}

/**
 * Best-effort cleanup of stale agent-state snapshots owned by THIS process.
 * The new child gets a new pid + attemptId, so it can't collide; we delete
 * our own stragglers so they don't accumulate under `~/.amplitude/wizard/state/`.
 *
 * Files are named `<attemptId>-<pid>.json` (see `getStateFile` in
 * `storage-paths.ts`). We only touch files matching the current pid.
 */
export function clearStaleAgentState(pid: number = process.pid): void {
  const stateDir = join(getCacheRoot(), 'state');
  if (!existsSync(stateDir)) return;
  let entries: string[];
  try {
    entries = readdirSync(stateDir);
  } catch {
    return;
  }
  const pidSuffix = `-${pid}.json`;
  for (const entry of entries) {
    if (!entry.endsWith(pidSuffix)) continue;
    const full = join(stateDir, entry);
    try {
      // Sanity: only delete plain files, not directories.
      if (statSync(full).isFile()) unlinkSync(full);
    } catch {
      // best-effort
    }
  }
}

/**
 * Build the argv list for the retry child process.
 * Exposed for unit testing.
 */
export function buildRetryArgs(
  binPath: string,
  rawArgs: readonly string[],
  installDir: string,
): { node: string; args: string[] } {
  const pruned = pruneArgs(rawArgs);
  return {
    node: process.execPath,
    args: [binPath, ...pruned, '--install-dir', installDir],
  };
}

/**
 * Spawn factory — extracted so tests can substitute a fake spawn without
 * patching `node:child_process` globally.
 */
export type SpawnFn = typeof spawn;

export interface RetryFromCheckpointOptions {
  /** Override `process.argv[1]` resolution (tests). */
  binPath?: string;
  /** Override `process.argv.slice(2)` (tests). */
  rawArgs?: readonly string[];
  /** Override the spawn function (tests). */
  spawnFn?: SpawnFn;
  /** Skip the actual `process.exit` call after child completes (tests). */
  skipExit?: boolean;
}

/**
 * Just enough of `WizardStore` for the retry call. Decoupling from the full
 * store keeps `lib/` from depending on `ui/tui/`.
 */
export interface RetryStoreLike {
  session: Pick<WizardSession, 'installDir' | 'outroData' | 'integration'>;
}

/**
 * Re-launch the wizard with the same install dir so it picks up the
 * checkpoint. Resolves with the child's exit code; the caller (OutroScreen)
 * does not normally need to inspect it because we propagate it via
 * `process.exit` here.
 *
 * This function is intentionally NOT async-throwing: any failure to spawn
 * is caught and surfaced as exit code 1, matching the "best-effort, not a
 * guarantee" contract of the retry hotkey.
 */
export async function retryFromCheckpoint(
  store: RetryStoreLike,
  opts: RetryFromCheckpointOptions = {},
): Promise<number> {
  const installDir = store.session.installDir;
  const binPath = opts.binPath ?? process.argv[1];
  const rawArgs = opts.rawArgs ?? process.argv.slice(2);
  const spawnFn = opts.spawnFn ?? spawn;

  analytics.wizardCapture('error outro retry pressed', {
    'outro kind': store.session.outroData?.kind ?? null,
    integration: store.session.integration ?? null,
  });

  // If `process.argv[1]` is missing somehow (corrupted invocation, weird
  // wrapper), bail out cleanly with exit code 1. The user can re-run by
  // hand. This is a "best-effort" hotkey, not a contract.
  if (!binPath) {
    if (!opts.skipExit) process.exit(1);
    return 1;
  }

  // Drop our own stale agent-state snapshot before the child starts. The
  // new child runs under a different pid + attemptId so it cannot hydrate
  // from our snapshot, but leaving it on disk is just litter.
  clearStaleAgentState();

  const { node, args } = buildRetryArgs(binPath, rawArgs, installDir);

  return new Promise<number>((resolve) => {
    let child;
    try {
      child = spawnFn(node, args, {
        stdio: 'inherit',
        // detached: false so the child shares our process group and Ctrl+C
        // is delivered to it. We're explicitly NOT detaching — we want the
        // child to BE the foreground wizard, taking over our terminal.
        detached: false,
      });
    } catch {
      if (!opts.skipExit) process.exit(1);
      resolve(1);
      return;
    }

    child.on('error', () => {
      if (!opts.skipExit) process.exit(1);
      resolve(1);
    });

    child.on('exit', (code: number | null) => {
      const exitCode = code ?? 1;
      if (!opts.skipExit) process.exit(exitCode);
      resolve(exitCode);
    });
  });
}
