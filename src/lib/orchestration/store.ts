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
import { getRunDir } from '../../utils/storage-paths';
import { dirname } from 'node:path';
import {
  type AddChoiceInput,
  type Choice,
  type ChoiceId,
  ChoiceStatus,
  ChoiceSchema,
  assertChoiceTransition,
  asChoiceId,
} from './checkpoints/choices';
import {
  type AddVerificationInput,
  type Verification,
  type VerificationId,
  VerificationStatus,
  VerificationSchema,
  assertVerificationTransition,
  asVerificationId,
} from './checkpoints/verifications';
import {
  type AddMcpCapabilityInput,
  type McpAppCapability,
  type McpAppCapabilityId,
  type McpAppCapabilityState,
  McpAppCapabilityState as McpStateEnum,
  McpAppCapabilitySchema,
  assertMcpTransition,
  asMcpAppCapabilityId,
} from './mcp-app-lifecycle';

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

export function newChoiceId(): ChoiceId {
  return `choice_${randomIdSegment()}`;
}

export function newVerificationId(): VerificationId {
  return `verif_${randomIdSegment()}`;
}

export function newMcpCapabilityId(
  kind: McpAppCapability['kind'],
): McpAppCapabilityId {
  return `mcp_${kind}_${randomIdSegment()}`;
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
    choices: [],
    verifications: [],
    mcpCapabilities: [],
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
  ensureDir(dirname(path));
  ensureDir(getRunDir(next.installDir));
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

  // ── Choices (PR 2) ────────────────────────────────────────────────

  /**
   * Add a new pending choice. De-dup helper: pass the same `promptId`
   * twice and the second call returns the existing record without
   * adding a duplicate. Callers that want a fresh prompt should mark
   * the prior one `superseded` first.
   */
  addChoice(input: AddChoiceInput): Choice {
    const store = this.read();
    const existing = store.choices.find(
      (c) => c.promptId === input.promptId && c.status === ChoiceStatus.Pending,
    );
    if (existing) return existing;

    const nowIso = new Date().toISOString();
    const choice: Choice = ChoiceSchema.parse({
      id: newChoiceId(),
      kind: input.kind,
      promptId: input.promptId,
      message: input.message,
      options: input.options,
      recommendedOptionId: input.recommendedOptionId ?? null,
      safeDefaultOptionId: input.safeDefaultOptionId ?? null,
      requiresHuman: input.requiresHuman,
      automationAllowed: input.automationAllowed,
      timeoutBehavior: input.timeoutBehavior ?? null,
      consequenceIfSkipped: input.consequenceIfSkipped,
      reversible: input.reversible,
      whyAsking: input.whyAsking,
      status: ChoiceStatus.Pending,
      answeredOptionId: null,
      answeredBy: null,
      createdAt: nowIso,
      answeredAt: null,
      expiresAt: input.expiresAt ?? null,
      resumeCommand: input.resumeCommand,
      linkedTaskId: input.linkedTaskId ?? null,
      linkedSessionId: input.linkedSessionId,
    });
    store.choices.push(choice);
    saveStore(store);
    return choice;
  }

  getChoice(id: ChoiceId): Choice | undefined {
    return this.read().choices.find((c) => c.id === id);
  }

  listChoices(filter?: {
    sessionId?: SessionId;
    status?: Choice['status'] | Choice['status'][];
    kind?: Choice['kind'] | Choice['kind'][];
  }): Choice[] {
    let choices = this.read().choices;
    if (filter?.sessionId) {
      choices = choices.filter((c) => c.linkedSessionId === filter.sessionId);
    }
    if (filter?.status) {
      const set = new Set(
        Array.isArray(filter.status) ? filter.status : [filter.status],
      );
      choices = choices.filter((c) => set.has(c.status));
    }
    if (filter?.kind) {
      const set = new Set(
        Array.isArray(filter.kind) ? filter.kind : [filter.kind],
      );
      choices = choices.filter((c) => set.has(c.kind));
    }
    return choices;
  }

  /**
   * Lookup a pending choice by its stable `promptId`. Used by producers
   * to avoid creating a duplicate when the same prompt fires twice
   * (typical for retries).
   */
  findPendingChoice(promptId: string): Choice | undefined {
    return this.read().choices.find(
      (c) => c.promptId === promptId && c.status === ChoiceStatus.Pending,
    );
  }

  /**
   * Mark a pending choice as `answered`. Throws when the choice is
   * already terminal or when the option id is unknown.
   */
  answerChoice(
    id: ChoiceId,
    optionId: string,
    by: 'human' | 'automation',
  ): Choice {
    const store = this.read();
    const choice = store.choices.find((c) => c.id === id);
    if (!choice) throw new Error(`Choice ${id} not found`);
    if (!choice.options.some((o) => o.id === optionId)) {
      throw new Error(
        `Choice ${id}: option '${optionId}' not in choice.options.`,
      );
    }
    assertChoiceTransition(choice.id, choice.status, ChoiceStatus.Answered);
    choice.status = ChoiceStatus.Answered;
    choice.answeredOptionId = optionId;
    choice.answeredBy = by;
    choice.answeredAt = new Date().toISOString();
    saveStore(store);
    return choice;
  }

  /** Generic update hook — re-validates the row before write. */
  updateChoice(id: ChoiceId, patch: Partial<Choice>): Choice {
    const store = this.read();
    const idx = store.choices.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error(`Choice ${id} not found`);
    const merged = { ...store.choices[idx], ...patch };
    if (patch.status && patch.status !== store.choices[idx].status) {
      assertChoiceTransition(id, store.choices[idx].status, patch.status);
    }
    const validated = ChoiceSchema.parse(merged);
    store.choices[idx] = validated;
    saveStore(store);
    return validated;
  }

  // ── Verifications (PR 2) ──────────────────────────────────────────

  addVerification(input: AddVerificationInput): Verification {
    const nowIso = new Date().toISOString();
    const verification: Verification = VerificationSchema.parse({
      id: newVerificationId(),
      kind: input.kind,
      whatToVerify: input.whatToVerify,
      commandToRun: input.commandToRun ?? [],
      expectedBehavior: input.expectedBehavior,
      status: VerificationStatus.Pending,
      blockingTaskId: input.blockingTaskId ?? null,
      blockingPRNumber: input.blockingPRNumber ?? null,
      blockingSessionId: input.blockingSessionId,
      unblockerHint: input.unblockerHint ?? null,
      createdAt: nowIso,
      completedAt: null,
      resumeCommand: input.resumeCommand,
    });
    const store = this.read();
    store.verifications.push(verification);
    saveStore(store);
    return verification;
  }

  getVerification(id: VerificationId): Verification | undefined {
    return this.read().verifications.find((v) => v.id === id);
  }

  listVerifications(filter?: {
    sessionId?: SessionId;
    status?: Verification['status'] | Verification['status'][];
    kind?: Verification['kind'] | Verification['kind'][];
  }): Verification[] {
    let verifications = this.read().verifications;
    if (filter?.sessionId) {
      verifications = verifications.filter(
        (v) => v.blockingSessionId === filter.sessionId,
      );
    }
    if (filter?.status) {
      const set = new Set(
        Array.isArray(filter.status) ? filter.status : [filter.status],
      );
      verifications = verifications.filter((v) => set.has(v.status));
    }
    if (filter?.kind) {
      const set = new Set(
        Array.isArray(filter.kind) ? filter.kind : [filter.kind],
      );
      verifications = verifications.filter((v) => set.has(v.kind));
    }
    return verifications;
  }

  markVerificationStatus(
    id: VerificationId,
    status: Verification['status'],
  ): Verification {
    const store = this.read();
    const verification = store.verifications.find((v) => v.id === id);
    if (!verification) throw new Error(`Verification ${id} not found`);
    assertVerificationTransition(id, verification.status, status);
    verification.status = status;
    if (
      status === VerificationStatus.Passed ||
      status === VerificationStatus.Failed ||
      status === VerificationStatus.Skipped ||
      status === VerificationStatus.Superseded
    ) {
      verification.completedAt = new Date().toISOString();
    }
    saveStore(store);
    return verification;
  }

  updateVerification(
    id: VerificationId,
    patch: Partial<Verification>,
  ): Verification {
    const store = this.read();
    const idx = store.verifications.findIndex((v) => v.id === id);
    if (idx < 0) throw new Error(`Verification ${id} not found`);
    const merged = { ...store.verifications[idx], ...patch };
    if (patch.status && patch.status !== store.verifications[idx].status) {
      assertVerificationTransition(
        id,
        store.verifications[idx].status,
        patch.status,
      );
    }
    const validated = VerificationSchema.parse(merged);
    store.verifications[idx] = validated;
    saveStore(store);
    return validated;
  }

  // ── MCP-app capabilities (PR 2) ───────────────────────────────────

  addMcpCapability(input: AddMcpCapabilityInput): McpAppCapability {
    const nowIso = new Date().toISOString();
    const capability: McpAppCapability = McpAppCapabilitySchema.parse({
      id: newMcpCapabilityId(input.kind),
      kind: input.kind,
      whyNeeded: input.whyNeeded,
      whatItEnables: input.whatItEnables,
      required: input.required,
      consequenceIfSkipped: input.consequenceIfSkipped,
      safeToSkip: input.safeToSkip,
      state: input.initialState ?? McpStateEnum.Available,
      userDecision: null,
      userDecisionAt: null,
      userDecisionResumeCommand: input.userDecisionResumeCommand,
      reversible: input.reversible,
      lastStateChangeAt: nowIso,
      lastStateChangeReason: input.lastStateChangeReason ?? null,
      linkedTaskId: input.linkedTaskId ?? null,
      linkedSessionId: input.linkedSessionId,
    });
    const store = this.read();
    store.mcpCapabilities.push(capability);
    saveStore(store);
    return capability;
  }

  getMcpCapability(id: McpAppCapabilityId): McpAppCapability | undefined {
    return this.read().mcpCapabilities.find((c) => c.id === id);
  }

  listMcpCapabilities(filter?: {
    sessionId?: SessionId;
    state?: McpAppCapabilityState | McpAppCapabilityState[];
    kind?: McpAppCapability['kind'] | McpAppCapability['kind'][];
  }): McpAppCapability[] {
    let capabilities = this.read().mcpCapabilities;
    if (filter?.sessionId) {
      capabilities = capabilities.filter(
        (c) => c.linkedSessionId === filter.sessionId,
      );
    }
    if (filter?.state) {
      const set = new Set(
        Array.isArray(filter.state) ? filter.state : [filter.state],
      );
      capabilities = capabilities.filter((c) => set.has(c.state));
    }
    if (filter?.kind) {
      const set = new Set(
        Array.isArray(filter.kind) ? filter.kind : [filter.kind],
      );
      capabilities = capabilities.filter((c) => set.has(c.kind));
    }
    return capabilities;
  }

  /**
   * Transition an MCP capability to a new state. Enforces the
   * legal-transition matrix AND the anti-nag invariant: re-asking a
   * previously-skipped capability requires an explicit `reason`.
   *
   * `userDecision` and `userDecisionAt` are stamped automatically when
   * the new state is `installed` or `install_skipped`.
   */
  transitionMcpCapability(
    id: McpAppCapabilityId,
    newState: McpAppCapabilityState,
    reason: string | null,
  ): McpAppCapability {
    const store = this.read();
    const capability = store.mcpCapabilities.find((c) => c.id === id);
    if (!capability) throw new Error(`MCP capability ${id} not found`);
    assertMcpTransition(id, capability.state, newState, reason);
    const nowIso = new Date().toISOString();
    capability.state = newState;
    capability.lastStateChangeAt = nowIso;
    capability.lastStateChangeReason = reason;
    if (newState === McpStateEnum.Installed) {
      capability.userDecision = 'installed';
      capability.userDecisionAt = nowIso;
    } else if (newState === McpStateEnum.InstallSkipped) {
      capability.userDecision = 'skipped';
      capability.userDecisionAt = nowIso;
    } else if (newState === McpStateEnum.NeedsUserChoice) {
      capability.userDecision = 'pending';
      // Clear the stale decision timestamp from a previous installed/skipped
      // state — consumers that infer "a decision has been made" from
      // `userDecisionAt !== null` would otherwise see a stale truthy value
      // even though the capability is back to pending.
      capability.userDecisionAt = null;
    }
    saveStore(store);
    return capability;
  }

  updateMcpCapability(
    id: McpAppCapabilityId,
    patch: Partial<McpAppCapability>,
  ): McpAppCapability {
    const store = this.read();
    const idx = store.mcpCapabilities.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error(`MCP capability ${id} not found`);
    const merged = { ...store.mcpCapabilities[idx], ...patch };
    if (patch.state && patch.state !== store.mcpCapabilities[idx].state) {
      assertMcpTransition(
        id,
        store.mcpCapabilities[idx].state,
        patch.state,
        patch.lastStateChangeReason ?? merged.lastStateChangeReason ?? null,
      );
    }
    const validated = McpAppCapabilitySchema.parse(merged);
    store.mcpCapabilities[idx] = validated;
    saveStore(store);
    return validated;
  }
}

// Re-export the typed id constructors so callers can get them from a
// single place (`OrchestrationStore` is the canonical entry point).
export { asChoiceId, asVerificationId, asMcpAppCapabilityId };

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
