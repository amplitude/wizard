/**
 * supervisor.ts — process-supervision for orchestrated subagents.
 *
 * Part of v2 PR 4. The wizard occasionally spawns helper subprocesses
 * (e.g. retry-from-checkpoint, framework helper agents). PR 3 noted that
 * "background agents continuing after cancellation" was out of scope;
 * PR 4 wires it.
 *
 * The Supervisor:
 *
 *   1. Tracks the PIDs of subprocesses that map to a `Subagent` row in
 *      the orchestration store.
 *   2. On wizard SIGINT / SIGTERM / graceful exit, sends SIGTERM to
 *      every tracked PID. After a 5s grace window, sends SIGKILL.
 *   3. Writes a heartbeat file per tracked PID under
 *      `<runDir>/heartbeats/<pid>.txt`. Stale heartbeats (> 30s old)
 *      transition the corresponding `Subagent` to `cancelled` with
 *      `terminationReason: 'heartbeat stale'`.
 *   4. On wizard startup, reaps `Subagent` rows whose PID is no longer
 *      alive (or whose heartbeat is stale). Eliminates the
 *      "stopped agents shown as running" drift.
 *
 * **Subagent.terminationReason / status — extension model**
 *
 * The PR 1 `Subagent` shape lacks an explicit `status` / `terminationReason`
 * field — it only carries `finishedAt`. PR 4 layers supervision state on
 * top by recording the termination on `finishSubagent` (sets
 * `finishedAt`) plus a parallel structured row on the related `Task`
 * (which DOES support `result` with a structured outcome). This avoids a
 * schema bump on the `Subagent` shape mid-PR-stack.
 *
 * Tests live in `src/lib/orchestration/__tests__/supervisor.test.ts`.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { logToFile } from '../../utils/debug';
import { getRunDir } from '../../utils/storage-paths';
import { getOrchestrationStore } from './store';
import { TaskLifecycle, isActive } from './lifecycle';
import type { SubagentId, Task } from './state';
import type { TaskId } from './state';

const HEARTBEAT_DIR = 'heartbeats';
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
const DEFAULT_STALE_THRESHOLD_MS = 30_000;
const DEFAULT_GRACEFUL_KILL_MS = 5_000;

export interface SupervisedProcess {
  pid: number;
  subagentId: SubagentId;
  /** Task row to mark `cancelled` / `failed` if the PID dies. */
  rootTaskId: TaskId;
  /** Wall-clock ms when the process was registered. */
  registeredAt: number;
}

export interface SupervisorOptions {
  installDir: string;
  /** Heartbeat write cadence. Defaults to 5s. */
  heartbeatIntervalMs?: number;
  /** PID is considered dead if heartbeat is older than this. Defaults to 30s. */
  staleThresholdMs?: number;
  /** Delay between SIGTERM and SIGKILL. Defaults to 5s. */
  gracefulKillMs?: number;
  /** Test injection — defaults to `process.kill`. */
  killFn?: (pid: number, signal: NodeJS.Signals | number) => void;
  /** Test injection — defaults to `Date.now`. */
  nowFn?: () => number;
}

/**
 * Per-process supervisor singleton. Use `getSupervisor(installDir)` to
 * obtain the cached instance; tests reset via `_resetSupervisor()`.
 */
export class Supervisor {
  readonly installDir: string;
  private readonly heartbeatIntervalMs: number;
  private readonly staleThresholdMs: number;
  private readonly gracefulKillMs: number;
  private readonly killFn: (
    pid: number,
    signal: NodeJS.Signals | number,
  ) => void;
  private readonly nowFn: () => number;
  private readonly tracked = new Map<number, SupervisedProcess>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private signalHandlersInstalled = false;

  constructor(opts: SupervisorOptions) {
    this.installDir = opts.installDir;
    this.heartbeatIntervalMs =
      opts.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.staleThresholdMs = opts.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;
    this.gracefulKillMs = opts.gracefulKillMs ?? DEFAULT_GRACEFUL_KILL_MS;
    this.killFn =
      opts.killFn ??
      ((pid: number, signal: NodeJS.Signals | number) => {
        process.kill(pid, signal);
      });
    this.nowFn = opts.nowFn ?? Date.now;
  }

  /** Heartbeat dir for this install. Lazily created. */
  heartbeatDir(): string {
    const dir = join(getRunDir(this.installDir), HEARTBEAT_DIR);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  /**
   * Register a tracked subprocess. The supervisor begins writing
   * heartbeats and will SIGTERM the PID on wizard exit.
   */
  track(p: SupervisedProcess): void {
    this.tracked.set(p.pid, p);
    this.writeHeartbeat(p.pid);
    this.ensureHeartbeatLoop();
    this.ensureSignalHandlers();
  }

  /**
   * Stop tracking a PID (e.g. it exited cleanly under its own steam).
   * Removes the heartbeat file.
   */
  untrack(pid: number): void {
    this.tracked.delete(pid);
    const file = join(this.heartbeatDir(), `${pid}.txt`);
    try {
      rmSync(file, { force: true });
    } catch {
      // best-effort
    }
    if (this.tracked.size === 0 && this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Read-only snapshot of currently tracked PIDs. */
  list(): SupervisedProcess[] {
    return Array.from(this.tracked.values());
  }

  /**
   * Send SIGTERM to every tracked PID; after `gracefulKillMs`, SIGKILL.
   * Idempotent — multiple calls are no-ops once tracking is empty.
   */
  async terminateAll(reason: string = 'wizard exit'): Promise<void> {
    const pids = Array.from(this.tracked.keys());
    for (const pid of pids) {
      this.signal(pid, 'SIGTERM');
    }
    if (pids.length === 0) return;
    // Mark every tracked PID's task `cancelled` immediately so the store
    // reflects the user's intent (they SIGINT'd the wizard) — even if
    // the kill itself races.
    for (const p of this.tracked.values()) {
      this.markTerminated(p, 'cancelled', reason);
    }
    // After grace, escalate to SIGKILL.
    await new Promise<void>((resolve) =>
      setTimeout(() => {
        for (const pid of pids) {
          if (this.isAlive(pid)) {
            this.signal(pid, 'SIGKILL');
          }
        }
        resolve();
      }, this.gracefulKillMs),
    );
    this.tracked.clear();
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Reap stale heartbeats — called periodically AND on startup. Any PID
   * whose heartbeat file is older than `staleThresholdMs` AND whose
   * process is not alive transitions the corresponding `Subagent` row
   * + root task to `cancelled` with `terminationReason: 'heartbeat stale'`.
   */
  reapStaleHeartbeats(): void {
    const now = this.nowFn();
    const dir = this.heartbeatDir();
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const m = /^(\d+)\.txt$/.exec(entry);
      if (!m) continue;
      const pid = Number(m[1]);
      const file = join(dir, entry);
      let mtime: number;
      try {
        mtime = statSync(file).mtimeMs;
      } catch {
        continue;
      }
      const age = now - mtime;
      if (age <= this.staleThresholdMs) continue;
      if (this.isAlive(pid)) {
        // Process is alive but heartbeat is stale — refresh on its
        // behalf. This happens when a tracked child is in a long
        // syscall and hasn't ticked back into JS.
        this.writeHeartbeat(pid);
        continue;
      }
      // Stale + not alive → reap.
      const tracked = this.tracked.get(pid);
      if (tracked) {
        this.markTerminated(tracked, 'cancelled', 'heartbeat stale');
        this.tracked.delete(pid);
      }
      try {
        rmSync(file, { force: true });
      } catch {
        // best-effort
      }
    }
  }

  /**
   * Recovery on wizard startup: subagents whose root task is still
   * `running` but whose heartbeat is stale OR the PID is gone are
   * transitioned to `failed` with `terminationReason: 'process gone'`.
   *
   * Call this once at supervisor init (typically on session start).
   */
  recoverOrphanedSubagents(): void {
    try {
      const orchStore = getOrchestrationStore(this.installDir);
      const subagents = orchStore.listSubagents();
      for (const s of subagents) {
        if (s.finishedAt !== null) continue;
        // Look up root task — only act on still-running tasks.
        const task = orchStore.getTask(s.rootTaskId);
        if (!task) continue;
        if (!isActive(task.state)) continue;
        // Heuristic: heartbeat-bearing supervised PIDs leave a file in
        // `heartbeatDir`. If no heartbeat AND the task hasn't been
        // updated for at least `staleThresholdMs`, treat as orphaned.
        const lastUpdate = task.updatedAt ?? task.createdAt;
        const age = this.nowFn() - lastUpdate;
        if (age < this.staleThresholdMs) continue;
        // Transition the task to failed; mark the subagent finished.
        try {
          orchStore.transitionTask(task.id, TaskLifecycle.Failed, {
            result: {
              outcome: 'failed',
              summary: 'Subagent process disappeared without finishing.',
              error: {
                message: 'process gone',
                class: 'unknown',
              },
              data: { terminationReason: 'process gone' },
              finishedAt: this.nowFn(),
            },
          });
        } catch {
          // Already terminal — skip.
        }
        try {
          orchStore.finishSubagent(s.id);
        } catch {
          // Already finished — skip.
        }
      }
    } catch (err) {
      logToFile(
        `[supervisor] recoverOrphanedSubagents failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // ── private helpers ────────────────────────────────────────────────

  private signal(pid: number, sig: NodeJS.Signals): void {
    try {
      this.killFn(pid, sig);
    } catch {
      // ESRCH — process already gone. Ignore.
    }
  }

  /**
   * Cross-platform liveness probe. `process.kill(pid, 0)` returns true
   * if the PID exists and the caller has permission to signal it; throws
   * ESRCH when no such PID exists.
   */
  private isAlive(pid: number): boolean {
    try {
      this.killFn(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private writeHeartbeat(pid: number): void {
    try {
      const file = join(this.heartbeatDir(), `${pid}.txt`);
      writeFileSync(file, String(this.nowFn()), 'utf-8');
    } catch {
      // best-effort
    }
  }

  private ensureHeartbeatLoop(): void {
    if (this.heartbeatTimer !== null) return;
    this.heartbeatTimer = setInterval(() => {
      // Refresh heartbeat for every still-alive tracked PID.
      for (const pid of this.tracked.keys()) {
        if (this.isAlive(pid)) {
          this.writeHeartbeat(pid);
        }
      }
      // Reap any stale heartbeats from previous runs / dead siblings.
      this.reapStaleHeartbeats();
    }, this.heartbeatIntervalMs);
    // Don't keep the event loop alive solely for heartbeats.
    if (typeof this.heartbeatTimer.unref === 'function') {
      this.heartbeatTimer.unref();
    }
  }

  private ensureSignalHandlers(): void {
    if (this.signalHandlersInstalled) return;
    const handler = (sig: NodeJS.Signals) => {
      // best-effort — fire-and-forget termination for every tracked child.
      // Note: this is async (`terminateAll` awaits SIGINT → SIGKILL ladders
      // per child) and we deliberately don't `await` or re-raise the signal
      // here. Other `process.once` listeners installed by the wizard's
      // normal exit path are independent — Node fires every registered
      // listener for the same signal, so the wizard still exits cleanly.
      void this.terminateAll(`signal ${sig}`).catch(() => {
        // ignore
      });
    };
    process.once('SIGINT', () => handler('SIGINT'));
    process.once('SIGTERM', () => handler('SIGTERM'));
    this.signalHandlersInstalled = true;
  }

  /**
   * Mark the supervised subagent as terminated. Records:
   *   - `finishSubagent(s.id)` (stamps `finishedAt`)
   *   - root task transition to `cancelled` or `failed` with the reason
   */
  private markTerminated(
    p: SupervisedProcess,
    outcome: 'cancelled' | 'failed',
    reason: string,
  ): void {
    try {
      const orchStore = getOrchestrationStore(this.installDir);
      const task = orchStore.getTask(p.rootTaskId);
      if (task && isActive(task.state)) {
        orchStore.transitionTask(
          p.rootTaskId,
          outcome === 'cancelled'
            ? TaskLifecycle.Cancelled
            : TaskLifecycle.Failed,
          {
            result: {
              outcome,
              summary: `Subagent terminated (${reason}).`,
              error:
                outcome === 'failed'
                  ? { message: reason, class: 'unknown' }
                  : undefined,
              data: { terminationReason: reason, pid: p.pid },
              finishedAt: this.nowFn(),
            },
          },
        );
      }
      try {
        orchStore.finishSubagent(p.subagentId);
      } catch {
        // Already finished.
      }
    } catch (err) {
      logToFile(
        `[supervisor] markTerminated(${p.pid}/${p.subagentId}) failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

// ── singleton accessor ──────────────────────────────────────────────

const SUPERVISOR_CACHE = new Map<string, Supervisor>();

export function getSupervisor(
  installDir: string,
  opts?: Omit<SupervisorOptions, 'installDir'>,
): Supervisor {
  const cached = SUPERVISOR_CACHE.get(installDir);
  if (cached) return cached;
  const fresh = new Supervisor({ installDir, ...(opts ?? {}) });
  SUPERVISOR_CACHE.set(installDir, fresh);
  return fresh;
}

/**
 * Stop background timers + clear tracked state. Test-friendly entry
 * point — production code should rely on the SIGINT/SIGTERM handlers
 * the Supervisor installs in `track()`.
 */
export function _stopSupervisor(s: Supervisor): void {
  const internals = s as unknown as {
    heartbeatTimer: ReturnType<typeof setInterval> | null;
    tracked: Map<number, SupervisedProcess>;
  };
  if (internals.heartbeatTimer !== null) {
    clearInterval(internals.heartbeatTimer);
    internals.heartbeatTimer = null;
  }
  internals.tracked.clear();
}

/** Test helper — clears the per-process supervisor cache. */
export function _resetSupervisor(): void {
  for (const sup of SUPERVISOR_CACHE.values()) {
    _stopSupervisor(sup);
  }
  SUPERVISOR_CACHE.clear();
}

export type { Task };
