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
import { ChoiceStatus, type Choice } from './checkpoints/choices';
import {
  VerificationStatus,
  type Verification,
} from './checkpoints/verifications';
import {
  McpAppCapabilityState,
  type McpAppCapability,
} from './mcp-app-lifecycle';

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

/**
 * Project a typed Choice / Verification / McpAppCapability record into
 * the legacy `PendingCheckpoint` shape so PR 1-era consumers of the
 * `LastStoppingPoint.pending*` arrays keep working. PR 3 will read the
 * full typed records directly via the store APIs.
 *
 * `enteredAt` is rendered as a wall-clock ms timestamp to match the
 * PendingCheckpoint contract; when the underlying ISO string is
 * unparseable (rare, since we stamp these ourselves) we fall back to 0
 * rather than throw — the snapshot is best-effort by design.
 */
function isoToMillis(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function choiceToCheckpoint(c: Choice): PendingCheckpoint {
  return {
    id: c.id,
    kind: c.kind,
    summary: c.message,
    enteredAt: isoToMillis(c.createdAt),
  };
}

function mcpCapabilityToCheckpoint(c: McpAppCapability): PendingCheckpoint {
  return {
    id: c.id,
    kind: `mcp_${c.kind}`,
    summary: `${c.kind} (${c.state}): ${c.whyNeeded}`,
    enteredAt: isoToMillis(c.lastStateChangeAt),
  };
}

function verificationToCheckpoint(v: Verification): PendingCheckpoint {
  return {
    id: v.id,
    kind: `verify_${v.kind}`,
    summary: v.whatToVerify,
    enteredAt: isoToMillis(v.createdAt),
  };
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
  pendingChoices: PendingCheckpoint[];
  pendingMcpActions: PendingCheckpoint[];
  pendingManualVerifications: PendingCheckpoint[];
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

  // No `waiting` task surfaced, but the store may still have free-floating
  // pending checkpoints (a Choice / Verification / MCP capability
  // recorded by PR 2 wiring before PR 3 hooks tasks to them). Surface
  // those so `wizard status` doesn't claim "nothing to resume" while
  // the user has a real pending decision sitting in the store.
  if (args.pendingChoices.length > 0) {
    return {
      kind: 'await_user_choice',
      description: `A user choice is pending: ${
        args.pendingChoices[0].summary ?? args.pendingChoices[0].kind
      }.`,
      command: fullCommand(),
    };
  }
  if (args.pendingMcpActions.length > 0) {
    return {
      kind: 'await_mcp_action',
      description: `An MCP-app action is pending: ${
        args.pendingMcpActions[0].summary ?? args.pendingMcpActions[0].kind
      }.`,
      command: fullCommand(),
    };
  }
  if (args.pendingManualVerifications.length > 0) {
    return {
      kind: 'await_verification',
      description: `Manual verification pending: ${
        args.pendingManualVerifications[0].summary ??
        args.pendingManualVerifications[0].kind
      }.`,
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
    return {
      kind: 'inspect_failure',
      description: `Most recent stop: ${recent.label} (${recent.state}). Inspect with \`${CLI_INVOCATION} task ${recent.id}\`.`,
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
    ? (file.sessions.find((s) => s.id === options.sessionId) ?? null)
    : (file.sessions
        .filter((s) => s.status === 'active')
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null);

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

  // PR 2: read real Choice / Verification / McpAppCapability records
  // from the store. We project them into the legacy `PendingCheckpoint`
  // shape so `LastStoppingPoint` stays back-compat with PR 1 consumers
  // — outer agents that already coded against the stub array shape see
  // the same fields populated from real data. PR 3's TUI will read the
  // typed records directly via the new store APIs.
  const pendingChoices: PendingCheckpoint[] = file.choices
    .filter((c: Choice) => c.status === ChoiceStatus.Pending)
    .map(choiceToCheckpoint);
  const pendingMcpActions: PendingCheckpoint[] = file.mcpCapabilities
    .filter(
      (c: McpAppCapability) =>
        c.state === McpAppCapabilityState.NeedsUserChoice ||
        c.state === McpAppCapabilityState.NeedsAuth ||
        c.state === McpAppCapabilityState.NeedsInstall,
    )
    .map(mcpCapabilityToCheckpoint);
  const pendingManualVerifications: PendingCheckpoint[] = file.verifications
    .filter(
      (v: Verification) =>
        v.status === VerificationStatus.Pending ||
        v.status === VerificationStatus.Failed,
    )
    .map(verificationToCheckpoint);

  const cliInvocation = options?.cliInvocation ?? CLI_INVOCATION.split(/\s+/);
  const nextAction = deriveNextAction({
    installDir,
    activeTasks,
    stoppedTasks,
    pendingChoices,
    pendingMcpActions,
    pendingManualVerifications,
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
    resumeCommand: nextAction.command.join(' '),
  };
}
