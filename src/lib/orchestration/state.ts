/**
 * Orchestration state — TS types for the durable orchestration store.
 *
 * Part of the v2 foundation (PR 1 of 3). Introduces a single durable surface
 * that becomes the source of truth for sessions, tasks, subagents, ownership,
 * and last-stopping-point. PRs 2 and 3 will wire user-choice / verification /
 * MCP-app lifecycle and the TUI redesign onto this foundation.
 *
 * **NOT a replacement for `WizardSession` yet.** This PR introduces both
 * surfaces in parallel — see `docs/orchestration.md` for the migration plan.
 */
import type { TaskLifecycle } from './lifecycle';

// ── ID typing ─────────────────────────────────────────────────────────
//
// Template-literal types with a structural prefix. Plain strings — no Zod
// brand or unique symbol — because the ids round-trip through JSON I/O and
// callers across CLI commands construct them from positional argv strings
// (`wizard task <id>`). The Zod schemas in `schemas.ts` validate the shape
// at the I/O boundary; downstream code can treat the prefix as advisory.

export type SessionId = `session_${string}`;
export type TaskId = `task_${string}`;
export type SubagentId = `subagent_${string}`;

/**
 * Helpers to assert that a raw string carries the expected prefix. Used at
 * trust boundaries (CLI argv) where we have a `string` and want a typed id.
 * Throws on mismatch — callers either pass a valid id or surface the error.
 */
export function asSessionId(raw: string): SessionId {
  if (!raw.startsWith('session_')) {
    throw new Error(`Expected session_<id>, got '${raw}'`);
  }
  return raw as SessionId;
}
export function asTaskId(raw: string): TaskId {
  if (!raw.startsWith('task_')) {
    throw new Error(`Expected task_<id>, got '${raw}'`);
  }
  return raw as TaskId;
}
export function asSubagentId(raw: string): SubagentId {
  if (!raw.startsWith('subagent_')) {
    throw new Error(`Expected subagent_<id>, got '${raw}'`);
  }
  return raw as SubagentId;
}

// ── Subagent kinds ───────────────────────────────────────────────────
//
// The wizard runs several distinct kinds of subagent during a session. We
// type them explicitly so the store and any read tool can show meaningful
// rows ("integration agent waiting on user choice") instead of opaque rows.
//
// Stays a string union (not enum) so future PRs can add new kinds without
// rewriting downstream consumers.

export type SubagentKind =
  | 'framework_detection'
  | 'integration'
  | 'taxonomy'
  | 'instrumentation'
  | 'chart_creation'
  | 'dashboard_creation'
  | 'verification'
  | 'feature_discovery'
  | 'mcp_install'
  | 'unknown';

// ── Ownership ────────────────────────────────────────────────────────

/**
 * A resource a task currently owns. Used to derive last-stopping-point's
 * "relevant branches / worktrees / PRs" surface and to drive resume hints.
 *
 * Stays a discriminated union because the fields differ meaningfully between
 * a branch (just a name), a worktree (path), and a PR (number + url).
 */
export type Ownership =
  | {
      kind: 'branch';
      name: string;
      /** Optional remote (origin, upstream). */
      remote?: string;
    }
  | {
      kind: 'worktree';
      path: string;
      /** Branch the worktree is checked out to, when known. */
      branch?: string;
    }
  | {
      kind: 'pull_request';
      number: number;
      /** Repo nameWithOwner, e.g. "amplitude/wizard". */
      repo: string;
      url: string;
      state?: 'open' | 'closed' | 'merged';
    }
  | {
      kind: 'file';
      path: string;
    };

// ── Pending checkpoint (stub for PR 2) ───────────────────────────────

/**
 * A pending user choice / verification / MCP action that the task is paused
 * on. PR 1 keeps this opaque (just an id + kind string) so downstream
 * consumers can render generic "waiting for user choice" rows. PR 2 will
 * widen this with concrete schemas (Zod-typed prompt content, choice options,
 * timeouts, etc.).
 */
export interface PendingCheckpoint {
  /** Stable id — referenced by resume commands. */
  id: string;
  /** Free-form classifier — `event_plan_confirm`, `mcp_install`, etc. */
  kind: string;
  /**
   * Best-effort human-readable summary. Optional because PR 2 will replace
   * this with structured prompt content.
   */
  summary?: string;
  /** Wall-clock ms when the task entered this waiting state. */
  enteredAt: number;
}

// ── Task ──────────────────────────────────────────────────────────────

/**
 * Structured task result (success or failure). Kept Zod-validated at the I/O
 * boundary so downstream tools / outer agents can rely on the shape.
 *
 * `errorClass` is a coarse classification orchestrators can branch on without
 * regex-matching error messages: `auth`, `network`, `validation`, etc.
 */
export interface TaskResult {
  /** Terminal outcome. */
  outcome: 'completed' | 'failed' | 'cancelled' | 'superseded';
  /** Brief one-line summary. */
  summary?: string;
  /** When `outcome === 'failed'`, structured error info. */
  error?: {
    message: string;
    class:
      | 'auth'
      | 'network'
      | 'validation'
      | 'permission'
      | 'cancelled'
      | 'internal'
      | 'unknown';
    /** Optional stable error code surfaced by the failing op. */
    code?: string;
  };
  /** Free-form structured payload — e.g. `{ branch, prUrl }`. */
  data?: Record<string, unknown>;
  /** Wall-clock ms when the task transitioned to this terminal. */
  finishedAt: number;
}

export interface Task {
  id: TaskId;
  /** Owning session. */
  sessionId: SessionId;
  /**
   * Human-readable label. Append-only until terminal — orchestrators can
   * key off `id` for stability and use `label` for display.
   */
  label: string;
  /** Optional present-continuous form ("running tests…"). */
  activeForm?: string;
  state: TaskLifecycle;
  /**
   * Lifecycle ownership — what this task is currently responsible for.
   * Empty when the task hasn't claimed anything yet.
   */
  ownership: Ownership[];
  /** Pending checkpoint when `state === 'waiting_for_user'`. */
  waitingFor?: PendingCheckpoint;
  /**
   * Free-form reason a `blocked` task is stuck. e.g. "no Amplitude login",
   * "network unreachable". Surfaces in `wizard task <id>` output.
   */
  blockedReason?: string;
  /** Optional parent task id for hierarchical tasks. */
  parentTaskId?: TaskId;
  /** Subagent kind for typed task wrappers; `null` for plain tasks. */
  subagentKind: SubagentKind | null;
  /** Wall-clock ms when the task was created. */
  createdAt: number;
  /** Wall-clock ms when the task most recently transitioned. */
  updatedAt: number;
  /** Wall-clock ms when the task entered `running` (null until started). */
  startedAt: number | null;
  /** Set when the task transitions to a terminal state. */
  result?: TaskResult;
  /**
   * For `superseded` terminal: the task that replaced this one. We track this
   * at the data layer (not just in result.data) so derived views can fan out
   * the relationship without re-parsing JSON.
   */
  supersededBy?: TaskId;
}

// ── Subagent ──────────────────────────────────────────────────────────

/**
 * A typed wrapper around a task hierarchy. Subagents are a navigation/grouping
 * concept: one subagent kind ("integration") may run multiple tasks ("install
 * SDK", "wire init()", "commit").
 *
 * Tasks reference their owning subagent via `parentTaskId`'s ancestry chain;
 * the store provides helpers to resolve ancestors. PR 1 only introduces the
 * shape — PR 2 will widen the contract.
 */
export interface Subagent {
  id: SubagentId;
  sessionId: SessionId;
  kind: SubagentKind;
  /** Root task spawned by this subagent. */
  rootTaskId: TaskId;
  /** Wall-clock ms when the subagent started. */
  createdAt: number;
  /** Wall-clock ms when the subagent terminated, or null if still active. */
  finishedAt: number | null;
}

// ── Session ───────────────────────────────────────────────────────────

/**
 * A single wizard run. One per process today; the store can hold many for
 * historical lookup.
 */
export interface Session {
  id: SessionId;
  /** Project this session ran against. */
  installDir: string;
  /** Wall-clock ms when the session started. */
  createdAt: number;
  /** Wall-clock ms when the session most recently emitted progress. */
  updatedAt: number;
  /** Optional human-readable goal — e.g. "set up Amplitude in Next.js app". */
  goal?: string;
  /** Active branch name, when known. */
  branch?: string;
  /** Active worktree path, when known. */
  worktree?: string;
  /**
   * Terminal status of the session:
   *   - `active`   — wizard is still running (or crashed; the rest is implied
   *                  by the per-task state)
   *   - `succeeded` — main run finished cleanly
   *   - `failed`   — main run terminated in error
   *   - `cancelled` — user cancelled
   *   - `abandoned` — process exited without graceful close (lazily inferred
   *                   by readers based on age + lack of close marker)
   */
  status: 'active' | 'succeeded' | 'failed' | 'cancelled' | 'abandoned';
  /** Set when `status` becomes terminal. */
  finishedAt?: number;
}

// ── Last-stopping-point ──────────────────────────────────────────────

/**
 * Discrete "next action" recommendation. PR 1 keeps this open-ended; the goal
 * is to give outer agents a single field to read for a resume hint, plus the
 * exact command they should run.
 */
export interface NextAction {
  /**
   * Coarse classifier — `resume`, `fix_auth`, `await_user_choice`,
   * `inspect_failure`, `none`.
   */
  kind:
    | 'resume'
    | 'fix_auth'
    | 'await_user_choice'
    | 'await_mcp_action'
    | 'await_verification'
    | 'inspect_failure'
    | 'none';
  /** Human-readable description of the recommended action. */
  description: string;
  /** Exact command the user (or outer agent) should run, as argv array. */
  command: string[];
}

/**
 * Snapshot of the wizard's last stopping point — derived from the store at
 * read time so `wizard status` always returns a fresh view.
 *
 * Several arrays are stubs for PR 2 (`pendingChoices`, `pendingMcpActions`,
 * `pendingManualVerifications`). They're emitted as empty arrays in PR 1 so
 * the schema is stable across the trio of PRs and consumers can begin coding
 * against the shape today.
 */
export interface LastStoppingPoint {
  /** Wall-clock ms the snapshot was generated. */
  generatedAt: number;
  /** Active session id, when one is in flight. */
  currentSessionId: SessionId | null;
  /** Free-form goal of the active session. */
  currentGoal: string | null;
  /** Active branch / worktree, when known. */
  currentBranch: string | null;
  currentWorktree: string | null;
  /** Live tasks (running, waiting_for_user, blocked). */
  activeTasks: Task[];
  /** Tasks that ended (failed/cancelled/superseded) in the last 24h. */
  stoppedTasks: Task[];
  /** Tasks that completed in the last 24h. */
  recentlyCompletedTasks: Task[];
  /** Branches/worktrees/PRs owned by tasks in the store. */
  relevantOwnership: Ownership[];
  /** Stub for PR 2 — empty in PR 1. */
  pendingChoices: PendingCheckpoint[];
  /** Stub for PR 2 — empty in PR 1. */
  pendingMcpActions: PendingCheckpoint[];
  /** Stub for PR 2 — empty in PR 1. */
  pendingManualVerifications: PendingCheckpoint[];
  /** Recommended next step + exact resume command. */
  nextAction: NextAction;
  /** Same `nextAction.command` rendered as a copy-pasteable string. */
  resumeCommand: string;
}

// ── Store envelope ────────────────────────────────────────────────────

/**
 * On-disk schema version. Bump when changing the persisted layout — readers
 * fall back to a fresh empty store on mismatch (no auto-migration in PR 1).
 */
export const ORCHESTRATION_STORE_VERSION = 1;

/**
 * Top-level on-disk shape. Single JSON file per install dir.
 *
 * PR 2 additions (`choices`, `verifications`, `mcpCapabilities`) live
 * alongside `sessions` / `tasks` / `subagents`. They were added without
 * a version bump because the schema treats them as optional with empty
 * defaults — a PR 1 file still parses cleanly under the PR 2 reader.
 */
export interface OrchestrationStoreFile {
  version: typeof ORCHESTRATION_STORE_VERSION;
  /** ISO-8601 timestamp of the last write. */
  updatedAt: string;
  /** Project this store belongs to. */
  installDir: string;
  sessions: Session[];
  tasks: Task[];
  subagents: Subagent[];
  /** PR 2: typed user-choice records. */
  choices: import('./checkpoints/choices').Choice[];
  /** PR 2: manual-verification records. */
  verifications: import('./checkpoints/verifications').Verification[];
  /** PR 2: MCP-app capability lifecycle records. */
  mcpCapabilities: import('./mcp-app-lifecycle').McpAppCapability[];
}
