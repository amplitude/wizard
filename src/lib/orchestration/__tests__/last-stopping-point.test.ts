/**
 * `computeLastStoppingPoint` — derivation tests against fixture stores.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OrchestrationStore, _resetOrchestrationStoreCache } from '../store';
import { TaskLifecycle } from '../lifecycle';
import { computeLastStoppingPoint } from '../last-stopping-point';
import { createTempDir } from '../../../utils/__tests__/helpers/temp-dir.js';

let cacheRoot: string;
let installDir: string;
let cleanupCache: () => void;
let cleanupInstall: () => void;
const NOW = 1_715_000_000_000;

beforeEach(() => {
  ({ dir: cacheRoot, cleanup: cleanupCache } = createTempDir('orch-lsp-'));
  ({ dir: installDir, cleanup: cleanupInstall } = createTempDir(
    'orch-installdir-lsp-',
  ));
  process.env.AMPLITUDE_WIZARD_CACHE_DIR = cacheRoot;
  _resetOrchestrationStoreCache();
});

afterEach(() => {
  cleanupCache();
  cleanupInstall();
  delete process.env.AMPLITUDE_WIZARD_CACHE_DIR;
  _resetOrchestrationStoreCache();
});

describe('computeLastStoppingPoint — empty store', () => {
  it('returns nextAction.kind=none when nothing is recorded', () => {
    const lsp = computeLastStoppingPoint(installDir, { now: NOW });
    expect(lsp.activeTasks).toEqual([]);
    expect(lsp.stoppedTasks).toEqual([]);
    expect(lsp.recentlyCompletedTasks).toEqual([]);
    expect(lsp.currentSessionId).toBeNull();
    expect(lsp.nextAction.kind).toBe('none');
  });
});

describe('computeLastStoppingPoint — populated store', () => {
  it('groups tasks by lifecycle and surfaces a waiting checkpoint as next action', () => {
    const store = new OrchestrationStore(installDir);
    const session = store.createSession({
      goal: 'integrate Amplitude in Next.js',
    });
    // Active running task.
    const running = store.createTask({
      sessionId: session.id,
      label: 'install SDK',
      initialState: TaskLifecycle.Running,
    });
    // Waiting task (the strongest "next action" signal).
    const waiting = store.createTask({
      sessionId: session.id,
      label: 'event plan confirmation',
      initialState: TaskLifecycle.Running,
    });
    store.transitionTask(waiting.id, TaskLifecycle.WaitingForUser, {
      waitingFor: {
        id: 'cp_abc',
        kind: 'event_plan_confirm',
        summary: 'review the proposed events.json',
        enteredAt: NOW - 5_000,
      },
    });
    // Completed task within 24h.
    const done = store.createTask({
      sessionId: session.id,
      label: 'detect framework',
      initialState: TaskLifecycle.Running,
    });
    store.transitionTask(done.id, TaskLifecycle.Completed);
    // Failed task within 24h.
    const failed = store.createTask({
      sessionId: session.id,
      label: 'first try',
      initialState: TaskLifecycle.Running,
    });
    store.transitionTask(failed.id, TaskLifecycle.Failed);

    const lsp = computeLastStoppingPoint(installDir, { now: NOW + 1_000 });
    // ActiveTasks contains the running + waiting tasks.
    expect(lsp.activeTasks.map((t) => t.id).sort()).toEqual(
      [running.id, waiting.id].sort(),
    );
    // Recently completed contains the completed task.
    expect(lsp.recentlyCompletedTasks.map((t) => t.id)).toContain(done.id);
    // Stopped contains the failed task.
    expect(lsp.stoppedTasks.map((t) => t.id)).toContain(failed.id);
    // Next action is await_user_choice with the checkpoint summary.
    expect(lsp.nextAction.kind).toBe('await_user_choice');
    expect(lsp.nextAction.description).toMatch(
      /event plan|review the proposed/,
    );
    // Current session and goal surface.
    expect(lsp.currentSessionId).toBe(session.id);
    expect(lsp.currentGoal).toBe('integrate Amplitude in Next.js');
  });

  it('surfaces auth-blocked tasks as fix_auth next-action', () => {
    const store = new OrchestrationStore(installDir);
    const session = store.createSession({});
    const t = store.createTask({
      sessionId: session.id,
      label: 'agent run',
      initialState: TaskLifecycle.Running,
    });
    store.transitionTask(t.id, TaskLifecycle.Blocked, {
      blockedReason: 'Amplitude login expired — re-authenticate.',
    });
    const lsp = computeLastStoppingPoint(installDir, { now: NOW });
    expect(lsp.nextAction.kind).toBe('fix_auth');
    expect(lsp.nextAction.command).toContain('login');
  });

  it('drops stopped tasks older than 24h from the snapshot bucket', () => {
    const store = new OrchestrationStore(installDir);
    const session = store.createSession({});
    const t = store.createTask({
      sessionId: session.id,
      label: 'old task',
      initialState: TaskLifecycle.Running,
    });
    store.transitionTask(t.id, TaskLifecycle.Failed);
    // Look at the LSP from 48h in the future — the failed task drops out.
    const lsp = computeLastStoppingPoint(installDir, {
      now: Date.now() + 48 * 60 * 60 * 1000,
    });
    expect(lsp.stoppedTasks).toEqual([]);
  });

  it('scopes session metadata + task buckets to the requested sessionId', () => {
    const store = new OrchestrationStore(installDir);
    // Older session — would otherwise lose the recency tiebreaker.
    const sessionA = store.createSession({ goal: 'session A' });
    const tA = store.createTask({
      sessionId: sessionA.id,
      label: 'A waiting task',
      initialState: TaskLifecycle.Running,
    });
    store.transitionTask(tA.id, TaskLifecycle.WaitingForUser, {
      waitingFor: {
        id: 'cp_a',
        kind: 'event_plan_confirm',
        summary: 'review A plan',
        enteredAt: NOW - 5_000,
      },
    });
    // Newer session — wins the default "most recently created active session"
    // selection, so without sessionId scoping the LSP would describe this one.
    const sessionB = store.createSession({ goal: 'session B' });
    const tB = store.createTask({
      sessionId: sessionB.id,
      label: 'B running task',
      initialState: TaskLifecycle.Running,
    });

    const lsp = computeLastStoppingPoint(installDir, {
      now: NOW + 1_000,
      sessionId: sessionA.id,
    });
    // Session metadata reflects the *requested* session, not the latest one.
    expect(lsp.currentSessionId).toBe(sessionA.id);
    expect(lsp.currentGoal).toBe('session A');
    // Task buckets are scoped to session A.
    expect(lsp.activeTasks.map((t) => t.id)).toEqual([tA.id]);
    expect(lsp.activeTasks.map((t) => t.id)).not.toContain(tB.id);
    // Next action describes session A's waiting checkpoint.
    expect(lsp.nextAction.kind).toBe('await_user_choice');
    expect(lsp.nextAction.description).toContain('review A plan');
  });

  it('aggregates ownership across active + recently-stopped tasks', () => {
    const store = new OrchestrationStore(installDir);
    const session = store.createSession({});
    const t1 = store.createTask({
      sessionId: session.id,
      label: 'task with branch',
      initialState: TaskLifecycle.Running,
    });
    store.addOwnership(t1.id, { kind: 'branch', name: 'feat/orchestration' });
    const t2 = store.createTask({
      sessionId: session.id,
      label: 'completed task with PR',
      initialState: TaskLifecycle.Running,
    });
    store.addOwnership(t2.id, {
      kind: 'pull_request',
      number: 7,
      repo: 'amplitude/wizard',
      url: 'https://github.com/amplitude/wizard/pull/7',
    });
    store.transitionTask(t2.id, TaskLifecycle.Completed);
    const lsp = computeLastStoppingPoint(installDir, { now: NOW });
    const kinds = lsp.relevantOwnership.map((o) => o.kind).sort();
    expect(kinds).toEqual(['branch', 'pull_request']);
  });
});
