/**
 * Derive a `LastStoppingPoint` snapshot from current store contents.
 *
 * Pure function — given a store + the current install dir, returns the
 * snapshot object that `wizard status --json` and the (forthcoming) MCP
 * server's read-only tool will emit. No I/O beyond a best-effort `git -C`
 * call to surface the active branch / worktree when the store hasn't
 * captured them yet.
 *
 * **Stub fields.** PR 1 emits empty arrays for `pendingChoices`,
 * `pendingMcpActions`, and `pendingManualVerifications`. PR 2 will widen
 * `PendingCheckpoint` and route the existing prompt sites through the store
 * so those arrays start carrying content. The fields are present in the
 * schema today so consumers can begin coding against the shape.
 */
import { execFileSync } from 'node:child_process';

import { TaskLifecycle, isActive } from './lifecycle';
import type {
  LastStoppingPoint,
  NextAction,
  Ownership,
  PendingCheckpoint,
  SessionId,
  Task,
} from './state';
import { getOrchestrationStore } from './store';
import { CLI_INVOCATION } from '../../commands/context';

/** Look-back window for "stopped" / "recently completed" task buckets. */
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Best-effort `git rev-parse --abbrev-ref HEAD`. Returns `null` if git is
 * not available, the cwd is not a git repo, or the call fails for any
 * reason — the LSP snapshot is still useful without a branch.
 */
function tryDetectBranch(installDir: string): string | null {
  try {
    const out = execFileSync(
      'git',
      ['-C', installDir, 'rev-parse', '--abbrev-ref', 'HEAD'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort `git rev-parse --show-toplevel`. The "worktree" we report is
 * the git worktree's checkout root — distinct from `installDir` (which may
 * be a subdirectory the wizard was launched from) but unaffected by the
 * orchestration store's own scoping.
 */
function tryDetectWorktree(installDir: string): string | null {
  try {
    const out = execFileSync(
      'git',
      ['-C', installDir, 'rev-parse', '--show-toplevel'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function dedupeOwnership(ownership: Ownership[]): Ownership[] {
  const seen = new Set<string>();
  const out: Ownership[] = [];
  for (const o of ownership) {
    const key = JSON.stringify(o);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(o);
    }
  }
  return out;
}

/**
 * Derive the recommended next action from the live task buckets. Coarse but
 * meaningful: a paused user prompt is more actionable than "everything's
 * fine"; an auth failure is more actionable than a generic stop.
 *
 * The string output of `command` is what the JSON consumer renders into a
 * `resumeCommand` field below.
 */
function deriveNextAction(args: {
  installDir: string;
  activeTasks: Task[];
  stoppedTasks: Task[];
  hasActiveSession: boolean;
  invocation: string[];
}): NextAction {
  const cliPrefix = args.invocation;
  const installDirArgs = ['--install-dir', args.installDir];
  const fullCommand = (...rest: string[]): string[] => [
    ...cliPrefix,
    ...rest,
    ...installDirArgs,
  ];

  const waiting = args.activeTasks.find(
    (t) => t.state === TaskLifecycle.WaitingForUser,
  );
  if (waiting) {
    const summary = waiting.waitingFor?.summary ?? waiting.label;
    return {
      kind: 'await_user_choice',
      description: `A task is waiting for user input: ${summary}.`,
      command: fullCommand(),
    };
  }

  const blockedAuth = args.activeTasks.find(
    (t) =>
      t.state === TaskLifecycle.Blocked &&
      typeof t.blockedReason === 'string' &&
      /(auth|sign[\s-]?in|login|token|credential)/i.test(t.blockedReason),
  );
  if (blockedAuth) {
    return {
      kind: 'fix_auth',
      description: `Blocked: ${
        blockedAuth.blockedReason ?? 'authentication required'
      }. Sign in again to resume.`,
      command: [...cliPrefix, 'login'],
    };
  }

  const otherBlocked = args.activeTasks.find(
    (t) => t.state === TaskLifecycle.Blocked,
  );
  if (otherBlocked) {
    return {
      kind: 'inspect_failure',
      description: `Blocked: ${
        otherBlocked.blockedReason ?? otherBlocked.label
      }. Inspect the task and address the blocker.`,
      command: [...cliPrefix, 'task', otherBlocked.id, ...installDirArgs],
    };
  }

  const stillRunning = args.activeTasks.some(
    (t) => t.state === TaskLifecycle.Running,
  );
  if (stillRunning) {
    return {
      kind: 'resume',
      description: 'A task is still running. Re-attach or wait for completion.',
      command: fullCommand('status'),
    };
  }

  if (args.hasActiveSession) {
    return {
      kind: 'resume',
      description:
        'Session is active but no task is running. Re-run the wizard to continue.',
      command: fullCommand(),
    };
  }

  if (args.stoppedTasks.length > 0) {
    const recent = args.stoppedTasks[0];
    // Use the configurable `cliPrefix` (sourced from
    // `options.cliInvocation`) for both the inline shell hint in
    // `description` and the structured `command`. Hardcoding
    // `CLI_INVOCATION` here meant a custom invocation (e.g. test harness,
    // alternate `wizard` symlink) would print the wrong command name in
    // the human-readable hint while emitting the correct one in JSON.
    const cliInline = cliPrefix.join(' ');
    return {
      kind: 'inspect_failure',
      description: `Most recent stop: ${recent.label} (${recent.state}). Inspect with \`${cliInline} task ${recent.id}\`.`,
      command: [...cliPrefix, 'task', recent.id, ...installDirArgs],
    };
  }

  return {
    kind: 'none',
    description: 'No active or recently stopped tasks. Nothing to resume.',
    command: fullCommand(),
  };
}

/**
 * Compute the LSP snapshot for the given install dir. Reads the latest store
 * snapshot and groups tasks by recency + state.
 *
 * `now` is injectable for testing — tests can pin `Date.now()` so the 24-hour
 * window is deterministic.
 *
 * `sessionId`, when provided, scopes the computation to that specific session:
 * the snapshot's session metadata and task buckets are restricted to that
 * session's tasks. This is what `wizard resume <session-id>` uses so the
 * derived next action belongs to the requested session, not the most-recently
 * created active session.
 */
export function computeLastStoppingPoint(
  installDir: string,
  options?: { now?: number; cliInvocation?: string[]; sessionId?: SessionId },
): LastStoppingPoint {
  const now = options?.now ?? Date.now();
  const cutoff = now - TWENTY_FOUR_HOURS_MS;
  const store = getOrchestrationStore(installDir);
  const file = store.read();

  const session = options?.sessionId
    ? file.sessions.find((s) => s.id === options.sessionId) ?? null
    : file.sessions
        .filter((s) => s.status === 'active')
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;

  const branch = session?.branch ?? tryDetectBranch(installDir);
  const worktree = session?.worktree ?? tryDetectWorktree(installDir);

  // When `sessionId` is provided, restrict task buckets to that session so
  // the derived next action reflects the requested session's state. Without
  // this, `wizard resume <session-id>` would surface tasks from a different
  // (more recently active) session.
  const scopedTasks = options?.sessionId
    ? file.tasks.filter((t) => t.sessionId === options.sessionId)
    : file.tasks;

  const activeTasks = scopedTasks
    .filter((t) => isActive(t.state))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const stoppedTasks = scopedTasks
    .filter(
      (t) =>
        (t.state === TaskLifecycle.Failed ||
          t.state === TaskLifecycle.Cancelled ||
          t.state === TaskLifecycle.Superseded) &&
        t.updatedAt >= cutoff,
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const recentlyCompletedTasks = scopedTasks
    .filter((t) => t.state === TaskLifecycle.Completed && t.updatedAt >= cutoff)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  // Aggregate ownership across all live tasks plus recently-stopped tasks
  // so the resume hint can surface "this task owned PR #123" even after
  // the task has terminated.
  const relevantOwnership = dedupeOwnership([
    ...activeTasks.flatMap((t) => t.ownership),
    ...stoppedTasks.flatMap((t) => t.ownership),
    ...recentlyCompletedTasks.flatMap((t) => t.ownership),
  ]);

  // PR 1 stub arrays — populated in PR 2. See module header. We do a single
  // pass over activeTasks and bucket each waiting checkpoint by `kind`; the
  // three output arrays carry the same partitioning the per-array filter
  // chains did, just without iterating activeTasks three times.
  const pendingChoices: PendingCheckpoint[] = [];
  const pendingMcpActions: PendingCheckpoint[] = [];
  const pendingManualVerifications: PendingCheckpoint[] = [];
  for (const t of activeTasks) {
    if (
      t.state !== TaskLifecycle.WaitingForUser ||
      t.waitingFor === undefined
    ) {
      continue;
    }
    const cp = t.waitingFor;
    if (cp.kind === 'user_choice' || cp.kind === 'event_plan_confirm') {
      pendingChoices.push(cp);
    } else if (cp.kind === 'mcp_install' || cp.kind === 'mcp_action') {
      pendingMcpActions.push(cp);
    } else if (cp.kind === 'manual_verification') {
      pendingManualVerifications.push(cp);
    }
  }

  const cliInvocation = options?.cliInvocation ?? CLI_INVOCATION.split(/\s+/);
  const nextAction = deriveNextAction({
    installDir,
    activeTasks,
    stoppedTasks,
    hasActiveSession: session !== null && session.status === 'active',
    invocation: cliInvocation,
  });

  return {
    generatedAt: now,
    currentSessionId: session?.id ?? null,
    currentGoal: session?.goal ?? null,
    currentBranch: branch ?? null,
    currentWorktree: worktree ?? null,
    activeTasks,
    stoppedTasks,
    recentlyCompletedTasks,
    relevantOwnership,
    pendingChoices,
    pendingMcpActions,
    pendingManualVerifications,
    nextAction,
    // Shell-quote any argv element that contains whitespace, quotes, or
    // shell metacharacters so the human-facing `resumeCommand` is
    // copy-pasteable when `installDir` (or any other argv) contains a
    // space — e.g. `/Users/me/my project`. Without this, the joined
    // string `wizard --install-dir /Users/me/my project` reaches the
    // shell as two separate words. The structured `command` array is
    // already correct; this only affects the human display.
    resumeCommand: shellJoin(nextAction.command),
  };
}

/** POSIX-shell-quote each token, then join with spaces. */
function shellJoin(argv: string[]): string {
  return argv.map(shellQuote).join(' ');
}

function shellQuote(arg: string): string {
  // Empty string must become '' so the shell sees an explicit empty arg.
  if (arg === '') return "''";
  // If the token is entirely "safe" (alnum + a small punctuation set we
  // know the shell won't interpret) leave it bare for readability.
  if (/^[A-Za-z0-9_\-/.:=@+,]+$/.test(arg)) return arg;
  // Otherwise wrap in single quotes; embedded single quotes get the
  // standard `'\''` close/escape/reopen dance.
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}
