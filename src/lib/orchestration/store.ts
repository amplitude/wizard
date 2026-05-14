/**
 * OrchestrationStore — durable, file-backed orchestration state.
 *
 * The store is the single source of truth for sessions, tasks, subagents,
 * and ownership. Reads come straight from disk (cheap; the file is small and
 * the process is short-lived) so external readers like the new CLI commands
 * always observe a consistent snapshot. Writes go through `atomicWriteJSON`
 * for crash-safety (temp file + rename) and validate the full envelope
 * against `OrchestrationStoreFileSchema` before serializing.
 *
 * **Concurrency model.** PR 1 assumes a single active wizard per install dir
 * — the existing `apply.lock` already enforces this for the high-mutation
 * apply path, and the orchestration store inherits the same assumption.
 * Cross-process coordination is therefore last-writer-wins. If two processes
 * race the store today they'll trample each other's tasks; the broader v2
 * plan addresses multi-writer in PR 3.
 *
 * **Cost model.** Each task transition triggers ≤ 1 atomic write of a small
 * JSON file. Sessions hold a few hundred tasks at most before the wizard
 * exits, so a typical run rewrites the file a few hundred times during its
 * lifetime — well under the I/O budget of `runs/<hash>/log.ndjson` writes
 * the wizard already does on every agent message.
 */
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { atomicWriteJSON } from '../../utils/atomic-write';
import { ensureDir } from '../../utils/storage-paths';
import {
  ORCHESTRATION_STORE_VERSION,
  type OrchestrationStoreFile,
  type Session,
  type SessionId,
  type Subagent,
  type SubagentId,
  type SubagentKind,
  type Task,
  type TaskId,
  type TaskResult,
  type Ownership,
  type PendingCheckpoint,
} from './state';
import { OrchestrationStoreFileSchema } from './schemas';
import { TaskLifecycle, assertTransition, isTerminal } from './lifecycle';
import { getOrchestrationStoreFile } from './storage-paths';
import { dirname } from 'node:path';

// ── Id helpers ────────────────────────────────────────────────────────

/** Random id segment — short, URL-safe, derived from `randomUUID`. */
function randomIdSegment(): string {
  return randomUUID().replace(/-/g, '').slice(0, 24);
}

export function newSessionId(): SessionId {
  return `session_${randomIdSegment()}`;
}

export function newTaskId(): TaskId {
  return `task_${randomIdSegment()}`;
}

export function newSubagentId(): SubagentId {
  return `subagent_${randomIdSegment()}`;
}

// ── Store ─────────────────────────────────────────────────────────────

/**
 * Empty store envelope for a given install dir. Used by readers to return a
 * stable shape when no store has been written yet.
 */
export function emptyStore(installDir: string): OrchestrationStoreFile {
  return {
    version: ORCHESTRATION_STORE_VERSION,
    updatedAt: new Date().toISOString(),
    installDir,
    sessions: [],
    tasks: [],
    subagents: [],
  };
}

/**
 * Result of `loadStore` — discriminated so callers can distinguish "no store
 * yet" (a fresh project) from "found a store but it was unparseable" (corrupt
 * or version mismatch). The CLI's `wizard status` exits with a different
 * code in the latter case so support tooling can distinguish them.
 */
export type LoadResult =
  | { kind: 'ok'; store: OrchestrationStoreFile; path: string }
  | { kind: 'missing'; path: string }
  | { kind: 'corrupt'; path: string; reason: string };

/**
 * Read the orchestration store from disk. Validates against the Zod schema
 * before returning — a partial / mismatched / version-bumped file surfaces as
 * `kind: 'corrupt'` rather than silently producing garbage.
 *
 * `corrupt` is recoverable on a per-tool basis: callers may ignore the
 * existing file and start fresh, or refuse and ask the user to investigate.
 */
export function loadStore(installDir: string): LoadResult {
  const path = getOrchestrationStoreFile(installDir);
  if (!existsSync(path)) {
    return { kind: 'missing', path };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    return {
      kind: 'corrupt',
      path,
      reason: `parse failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
  const parsed = OrchestrationStoreFileSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: 'corrupt',
      path,
      reason: `schema validation failed: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    };
  }
  // Zod's inferred output type widens our `session_<id>` template-literal
  // types back to `string`. The regex schemas guarantee the prefix is
  // present, so the cast back to `OrchestrationStoreFile` is sound.
  return {
    kind: 'ok',
    store: parsed.data as OrchestrationStoreFile,
    path,
  };
}

/**
 * Persist the store atomically. Validates the full envelope before writing,
 * so a programming bug in a mutator surfaces as a thrown ZodError on the
 * write path instead of producing a corrupted file.
 *
 * Mode `0o600` matches the existing per-user cache file convention. The
 * store can carry org/project ids (no tokens or keys), so 0o600 is enough.
 */
export function saveStore(store: OrchestrationStoreFile): void {
  const next: OrchestrationStoreFile = {
    ...store,
    updatedAt: new Date().toISOString(),
  };
  // Validate before writing — catches mutator bugs at the trust boundary.
  OrchestrationStoreFileSchema.parse(next);
  const path = getOrchestrationStoreFile(next.installDir);
  // `getOrchestrationStoreFile()` returns `join(getRunDir(installDir),
  // 'orchestration.json')`, so `dirname(path)` is exactly the run dir —
  // a single `ensureDir` covers both.
  ensureDir(dirname(path));
  atomicWriteJSON(path, next, { mode: 0o600 });
}

// ── Mutator API ───────────────────────────────────────────────────────

/**
 * High-level facade over the on-disk store. Stateless from the caller's
 * perspective — every mutator reads the current store, applies the change,
 * and writes back. That keeps the API pleasant for the small number of
 * lifecycle hook sites in PR 1 (session start, task transition, graceful
 * exit) without forcing them to track a long-lived in-memory handle.
 *
 * For the eventual high-frequency write sites (PR 2/3), we'll layer an
 * in-memory cache on top of this facade with debounced flushes. Not in PR 1.
 */
export class OrchestrationStore {
  readonly installDir: string;

  constructor(installDir: string) {
    this.installDir = installDir;
  }

  /** Read-only snapshot of the store. Always fresh from disk. */
  read(): OrchestrationStoreFile {
    const result = loadStore(this.installDir);
    if (result.kind === 'ok') return result.store;
    return emptyStore(this.installDir);
  }

  /** Path to the on-disk store file. */
  get path(): string {
    return getOrchestrationStoreFile(this.installDir);
  }

  /** True iff a store file exists for this install dir. */
  exists(): boolean {
    return existsSync(this.path);
  }

  // ── Sessions ──────────────────────────────────────────────────────

  createSession(input: {
    goal?: string;
    branch?: string;
    worktree?: string;
  }): Session {
    const now = Date.now();
    const session: Session = {
      id: newSessionId(),
      installDir: this.installDir,
      createdAt: now,
      updatedAt: now,
      goal: input.goal,
      branch: input.branch,
      worktree: input.worktree,
      status: 'active',
    };
    const store = this.read();
    store.sessions.push(session);
    saveStore(store);
    return session;
  }

  setSessionStatus(
    id: SessionId,
    status: Session['status'],
    options?: { branch?: string; worktree?: string; goal?: string },
  ): Session {
    const store = this.read();
    const session = store.sessions.find((s) => s.id === id);
    if (!session) {
      throw new Error(`Session ${id} not found`);
    }
    session.status = status;
    session.updatedAt = Date.now();
    if (status !== 'active' && session.finishedAt === undefined) {
      session.finishedAt = Date.now();
    }
    if (options?.branch !== undefined) session.branch = options.branch;
    if (options?.worktree !== undefined) session.worktree = options.worktree;
    if (options?.goal !== undefined) session.goal = options.goal;
    saveStore(store);
    return session;
  }

  getSession(id: SessionId): Session | undefined {
    return this.read().sessions.find((s) => s.id === id);
  }

  listSessions(): Session[] {
    return this.read().sessions;
  }

  /**
   * Most recently created active session, when one exists. Used by the
   * graceful-exit hook and `last-stopping-point` to find the "current"
   * session without forcing every caller to track a session id.
   */
  currentSession(): Session | undefined {
    return this.read()
      .sessions.filter((s) => s.status === 'active')
      .sort((a, b) => b.createdAt - a.createdAt)[0];
  }

  // ── Tasks ─────────────────────────────────────────────────────────

  createTask(input: {
    sessionId: SessionId;
    label: string;
    activeForm?: string;
    parentTaskId?: TaskId;
    subagentKind?: SubagentKind | null;
    /** Defaults to 'queued'. */
    initialState?: TaskLifecycle;
  }): Task {
    const now = Date.now();
    const initialState = input.initialState ?? TaskLifecycle.Queued;
    const task: Task = {
      id: newTaskId(),
      sessionId: input.sessionId,
      label: input.label,
      activeForm: input.activeForm,
      state: initialState,
      ownership: [],
      parentTaskId: input.parentTaskId,
      subagentKind: input.subagentKind ?? null,
      createdAt: now,
      updatedAt: now,
      startedAt: initialState === TaskLifecycle.Running ? now : null,
    };
    const store = this.read();
    store.tasks.push(task);
    saveStore(store);
    return task;
  }

  getTask(id: TaskId): Task | undefined {
    return this.read().tasks.find((t) => t.id === id);
  }

  listTasks(filter?: {
    sessionId?: SessionId;
    state?: TaskLifecycle | TaskLifecycle[];
  }): Task[] {
    let tasks = this.read().tasks;
    if (filter?.sessionId) {
      tasks = tasks.filter((t) => t.sessionId === filter.sessionId);
    }
    if (filter?.state) {
      const states = Array.isArray(filter.state)
        ? new Set(filter.state)
        : new Set([filter.state]);
      tasks = tasks.filter((t) => states.has(t.state));
    }
    return tasks;
  }

  /**
   * Transition a task to a new lifecycle state. Validates the transition
   * via `assertTransition` — illegal transitions throw
   * `IllegalTaskTransitionError`.
   */
  transitionTask(
    id: TaskId,
    to: TaskLifecycle,
    options?: {
      result?: TaskResult;
      waitingFor?: PendingCheckpoint;
      blockedReason?: string;
      supersededBy?: TaskId;
    },
  ): Task {
    const store = this.read();
    const task = store.tasks.find((t) => t.id === id);
    if (!task) throw new Error(`Task ${id} not found`);
    assertTransition(task.id, task.state, to);
    const now = Date.now();
    task.state = to;
    task.updatedAt = now;
    if (to === TaskLifecycle.Running && task.startedAt === null) {
      task.startedAt = now;
    }
    // Clear waiting/blocked context when leaving those states so the LSP
    // snapshot doesn't render stale "waiting for X" rows on a running task.
    if (to !== TaskLifecycle.WaitingForUser) {
      task.waitingFor = undefined;
    }
    if (to !== TaskLifecycle.Blocked) {
      task.blockedReason = undefined;
    }
    if (options?.waitingFor && to === TaskLifecycle.WaitingForUser) {
      task.waitingFor = options.waitingFor;
    }
    if (options?.blockedReason && to === TaskLifecycle.Blocked) {
      task.blockedReason = options.blockedReason;
    }
    if (isTerminal(to)) {
      // Map the terminal lifecycle to the narrower `TaskResult.outcome`.
      // The two surfaces overlap by design (completed/failed/cancelled/
      // superseded) but stay separate so a future PR can add result-only
      // fields (duration, retry count, etc.) without expanding the
      // lifecycle enum.
      const outcome: TaskResult['outcome'] =
        to === TaskLifecycle.Completed
          ? 'completed'
          : to === TaskLifecycle.Failed
          ? 'failed'
          : to === TaskLifecycle.Cancelled
          ? 'cancelled'
          : 'superseded';
      task.result = options?.result ?? {
        outcome,
        finishedAt: now,
      };
      if (to === TaskLifecycle.Superseded && options?.supersededBy) {
        task.supersededBy = options.supersededBy;
      }
    }
    saveStore(store);
    return task;
  }

  /** Add an ownership record to a task. Idempotent for identical entries. */
  addOwnership(taskId: TaskId, ownership: Ownership): Task {
    const store = this.read();
    const task = store.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const exists = task.ownership.some(
      (o) => JSON.stringify(o) === JSON.stringify(ownership),
    );
    if (!exists) {
      task.ownership.push(ownership);
      task.updatedAt = Date.now();
      saveStore(store);
    }
    return task;
  }

  // ── Subagents ────────────────────────────────────────────────────

  createSubagent(input: {
    sessionId: SessionId;
    kind: SubagentKind;
    rootTaskId: TaskId;
  }): Subagent {
    const now = Date.now();
    const subagent: Subagent = {
      id: newSubagentId(),
      sessionId: input.sessionId,
      kind: input.kind,
      rootTaskId: input.rootTaskId,
      createdAt: now,
      finishedAt: null,
    };
    const store = this.read();
    store.subagents.push(subagent);
    saveStore(store);
    return subagent;
  }

  finishSubagent(id: SubagentId): Subagent {
    const store = this.read();
    const subagent = store.subagents.find((s) => s.id === id);
    if (!subagent) throw new Error(`Subagent ${id} not found`);
    subagent.finishedAt = Date.now();
    saveStore(store);
    return subagent;
  }

  listSubagents(filter?: { sessionId?: SessionId }): Subagent[] {
    const subagents = this.read().subagents;
    if (filter?.sessionId) {
      return subagents.filter((s) => s.sessionId === filter.sessionId);
    }
    return subagents;
  }
}

// ── Singleton accessor ───────────────────────────────────────────────

/**
 * Per-process cache of `OrchestrationStore` instances, keyed by install dir.
 * Avoids spinning up a fresh facade for every transition while still letting
 * tests construct stores with overridden cache roots (the env override is
 * read by `getOrchestrationStoreFile` on every call).
 */
const STORE_CACHE = new Map<string, OrchestrationStore>();

export function getOrchestrationStore(installDir: string): OrchestrationStore {
  let store = STORE_CACHE.get(installDir);
  if (!store) {
    store = new OrchestrationStore(installDir);
    STORE_CACHE.set(installDir, store);
  }
  return store;
}

/** Test helper — clears the per-process cache. */
export function _resetOrchestrationStoreCache(): void {
  STORE_CACHE.clear();
}
