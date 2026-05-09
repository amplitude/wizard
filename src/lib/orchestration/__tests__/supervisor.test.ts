/**
 * Supervisor tests — process supervision for orchestrated subagents.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getOrchestrationStore, _resetOrchestrationStoreCache } from '../store';
import {
  Supervisor,
  _resetSupervisor,
  _stopSupervisor,
  type SupervisedProcess,
} from '../supervisor';
import { TaskLifecycle } from '../lifecycle';
import { getRunDir } from '../../../utils/storage-paths';

let installDir: string;
let originalCacheDir: string | undefined;

beforeEach(() => {
  installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-'));
  originalCacheDir = process.env.AMPLITUDE_WIZARD_CACHE_DIR;
  process.env.AMPLITUDE_WIZARD_CACHE_DIR = path.join(installDir, '.cache');
  _resetOrchestrationStoreCache();
  _resetSupervisor();
});
afterEach(() => {
  if (originalCacheDir === undefined) {
    delete process.env.AMPLITUDE_WIZARD_CACHE_DIR;
  } else {
    process.env.AMPLITUDE_WIZARD_CACHE_DIR = originalCacheDir;
  }
  _resetSupervisor();
  fs.rmSync(installDir, { recursive: true, force: true });
});

function makeSupervisor(opts?: {
  killFn?: (pid: number, sig: NodeJS.Signals | number) => void;
  nowFn?: () => number;
  staleThresholdMs?: number;
}): Supervisor {
  return new Supervisor({
    installDir,
    heartbeatIntervalMs: 100,
    staleThresholdMs: opts?.staleThresholdMs ?? 30_000,
    gracefulKillMs: 100,
    killFn: opts?.killFn,
    nowFn: opts?.nowFn,
  });
}

describe('Supervisor', () => {
  it('writes a heartbeat file under <runDir>/heartbeats/<pid>.txt on track', () => {
    const sup = makeSupervisor();
    const session = getOrchestrationStore(installDir).createSession({
      goal: 't',
    });
    const task = getOrchestrationStore(installDir).createTask({
      sessionId: session.id,
      label: 'helper',
    });
    const subagent = getOrchestrationStore(installDir).createSubagent({
      sessionId: session.id,
      kind: 'unknown',
      rootTaskId: task.id,
    });
    const proc: SupervisedProcess = {
      pid: 99999, // bogus, doesn't matter for heartbeat write
      subagentId: subagent.id,
      rootTaskId: task.id,
      registeredAt: Date.now(),
    };
    sup.track(proc);
    const file = path.join(getRunDir(installDir), 'heartbeats', '99999.txt');
    expect(fs.existsSync(file)).toBe(true);
    _stopSupervisor(sup);
  });

  it('terminateAll sends SIGTERM to every tracked PID and marks tasks cancelled', async () => {
    const sentSignals: Array<{ pid: number; sig: NodeJS.Signals | number }> =
      [];
    const sup = makeSupervisor({
      killFn: (pid, sig) => {
        sentSignals.push({ pid, sig });
        // Simulate "process gone" after the SIGTERM call so the SIGKILL
        // escalation path doesn't blow up on `kill(pid, 0)` either.
      },
    });
    const session = getOrchestrationStore(installDir).createSession({
      goal: 't',
    });
    const t1 = getOrchestrationStore(installDir).createTask({
      sessionId: session.id,
      label: 'a',
      initialState: TaskLifecycle.Running,
    });
    const t2 = getOrchestrationStore(installDir).createTask({
      sessionId: session.id,
      label: 'b',
      initialState: TaskLifecycle.Running,
    });
    const s1 = getOrchestrationStore(installDir).createSubagent({
      sessionId: session.id,
      kind: 'unknown',
      rootTaskId: t1.id,
    });
    const s2 = getOrchestrationStore(installDir).createSubagent({
      sessionId: session.id,
      kind: 'unknown',
      rootTaskId: t2.id,
    });
    sup.track({
      pid: 11111,
      subagentId: s1.id,
      rootTaskId: t1.id,
      registeredAt: Date.now(),
    });
    sup.track({
      pid: 22222,
      subagentId: s2.id,
      rootTaskId: t2.id,
      registeredAt: Date.now(),
    });
    await sup.terminateAll('test');
    expect(sentSignals.filter((s) => s.sig === 'SIGTERM')).toHaveLength(2);
    const after1 = getOrchestrationStore(installDir).getTask(t1.id);
    const after2 = getOrchestrationStore(installDir).getTask(t2.id);
    expect(after1!.state).toBe(TaskLifecycle.Cancelled);
    expect(after2!.state).toBe(TaskLifecycle.Cancelled);
    expect(after1!.result?.data?.terminationReason).toBe('test');
  });

  it('reapStaleHeartbeats marks orphaned tracked PIDs as cancelled', () => {
    let now = Date.now();
    const sup = makeSupervisor({
      nowFn: () => now,
      staleThresholdMs: 1_000,
      killFn: () => {
        // simulate pid not alive
        throw new Error('ESRCH');
      },
    });
    const session = getOrchestrationStore(installDir).createSession({
      goal: 't',
    });
    const task = getOrchestrationStore(installDir).createTask({
      sessionId: session.id,
      label: 'x',
      initialState: TaskLifecycle.Running,
    });
    const subagent = getOrchestrationStore(installDir).createSubagent({
      sessionId: session.id,
      kind: 'unknown',
      rootTaskId: task.id,
    });
    sup.track({
      pid: 33333,
      subagentId: subagent.id,
      rootTaskId: task.id,
      registeredAt: now,
    });
    // Move time forward past the threshold AND set the heartbeat file
    // mtime old enough to be stale.
    const file = path.join(getRunDir(installDir), 'heartbeats', '33333.txt');
    expect(fs.existsSync(file)).toBe(true);
    const past = (now - 5_000) / 1000;
    fs.utimesSync(file, past, past);
    now += 10_000;
    sup.reapStaleHeartbeats();
    const after = getOrchestrationStore(installDir).getTask(task.id);
    expect(after!.state).toBe(TaskLifecycle.Cancelled);
    expect(after!.result?.data?.terminationReason).toBe('heartbeat stale');
    _stopSupervisor(sup);
  });

  it('recoverOrphanedSubagents transitions stale running tasks to failed', () => {
    let now = Date.now();
    const sup = makeSupervisor({
      nowFn: () => now,
      staleThresholdMs: 1_000,
    });
    const session = getOrchestrationStore(installDir).createSession({
      goal: 't',
    });
    const task = getOrchestrationStore(installDir).createTask({
      sessionId: session.id,
      label: 'orphan',
      initialState: TaskLifecycle.Running,
    });
    getOrchestrationStore(installDir).createSubagent({
      sessionId: session.id,
      kind: 'unknown',
      rootTaskId: task.id,
    });
    // Advance time past the threshold.
    now += 5_000;
    sup.recoverOrphanedSubagents();
    const after = getOrchestrationStore(installDir).getTask(task.id);
    expect(after!.state).toBe(TaskLifecycle.Failed);
    expect(after!.result?.data?.terminationReason).toBe('process gone');
    _stopSupervisor(sup);
  });

  it('untrack removes the heartbeat file', () => {
    const sup = makeSupervisor();
    const session = getOrchestrationStore(installDir).createSession({
      goal: 't',
    });
    const task = getOrchestrationStore(installDir).createTask({
      sessionId: session.id,
      label: 'x',
    });
    const subagent = getOrchestrationStore(installDir).createSubagent({
      sessionId: session.id,
      kind: 'unknown',
      rootTaskId: task.id,
    });
    sup.track({
      pid: 44444,
      subagentId: subagent.id,
      rootTaskId: task.id,
      registeredAt: Date.now(),
    });
    const file = path.join(getRunDir(installDir), 'heartbeats', '44444.txt');
    expect(fs.existsSync(file)).toBe(true);
    sup.untrack(44444);
    expect(fs.existsSync(file)).toBe(false);
    _stopSupervisor(sup);
  });
});
