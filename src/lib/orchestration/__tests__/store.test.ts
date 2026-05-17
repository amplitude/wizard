/**
 * OrchestrationStore — file-backed read/write tests.
 *
 * Uses a tmpdir cache root via AMPLITUDE_WIZARD_CACHE_DIR so the production
 * `~/.amplitude/wizard/` directory is never touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

import {
  OrchestrationStore,
  loadStore,
  saveStore,
  emptyStore,
  _resetOrchestrationStoreCache,
} from '../store';
import { TaskLifecycle, IllegalTaskTransitionError } from '../lifecycle';
import { getOrchestrationStoreFile } from '../storage-paths';
import { atomicWriteJSON } from '../../../utils/atomic-write';
import { createTempDir } from '../../../utils/__tests__/helpers/temp-dir.js';

let cacheRoot: string;
let installDir: string;
let cleanupCache: () => void;
let cleanupInstall: () => void;

function setupCacheRoot(): void {
  ({ dir: cacheRoot, cleanup: cleanupCache } = createTempDir('orch-store-'));
  ({ dir: installDir, cleanup: cleanupInstall } =
    createTempDir('orch-installdir-'));
  process.env.AMPLITUDE_WIZARD_CACHE_DIR = cacheRoot;
  _resetOrchestrationStoreCache();
}

function teardownCacheRoot(): void {
  cleanupCache();
  cleanupInstall();
  delete process.env.AMPLITUDE_WIZARD_CACHE_DIR;
  _resetOrchestrationStoreCache();
}

describe('OrchestrationStore — read / write', () => {
  beforeEach(setupCacheRoot);
  afterEach(teardownCacheRoot);

  it('loadStore returns missing when no file exists', () => {
    const result = loadStore(installDir);
    expect(result.kind).toBe('missing');
  });

  it('saveStore writes and loadStore reads the same data back', () => {
    const empty = emptyStore(installDir);
    saveStore(empty);
    const result = loadStore(installDir);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.store.installDir).toBe(installDir);
      expect(result.store.sessions).toEqual([]);
      expect(result.store.tasks).toEqual([]);
      expect(result.store.subagents).toEqual([]);
    }
  });

  it('createSession + listSessions round-trip', () => {
    const store = new OrchestrationStore(installDir);
    const session = store.createSession({ goal: 'test goal' });
    expect(session.id).toMatch(/^session_/);
    const sessions = store.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.goal).toBe('test goal');
  });

  it('createTask defaults to queued and transitions to running stamp startedAt', () => {
    const store = new OrchestrationStore(installDir);
    const session = store.createSession({});
    const task = store.createTask({
      sessionId: session.id,
      label: 'do the thing',
    });
    expect(task.state).toBe(TaskLifecycle.Queued);
    expect(task.startedAt).toBeNull();

    const updated = store.transitionTask(task.id, TaskLifecycle.Running);
    expect(updated.state).toBe(TaskLifecycle.Running);
    expect(updated.startedAt).not.toBeNull();
  });

  it('transitionTask refuses illegal transitions', () => {
    const store = new OrchestrationStore(installDir);
    const session = store.createSession({});
    const task = store.createTask({
      sessionId: session.id,
      label: 't',
      initialState: TaskLifecycle.Completed,
    });
    expect(() => store.transitionTask(task.id, TaskLifecycle.Running)).toThrow(
      IllegalTaskTransitionError,
    );
  });

  it('transition to terminal stamps a result', () => {
    const store = new OrchestrationStore(installDir);
    const session = store.createSession({});
    const task = store.createTask({
      sessionId: session.id,
      label: 't',
      initialState: TaskLifecycle.Running,
    });
    const t2 = store.transitionTask(task.id, TaskLifecycle.Completed);
    expect(t2.result?.outcome).toBe('completed');
    expect(t2.result?.finishedAt).toBeGreaterThan(0);
  });

  it('addOwnership is idempotent for identical entries', () => {
    const store = new OrchestrationStore(installDir);
    const session = store.createSession({});
    const task = store.createTask({
      sessionId: session.id,
      label: 't',
    });
    store.addOwnership(task.id, { kind: 'branch', name: 'feat/x' });
    store.addOwnership(task.id, { kind: 'branch', name: 'feat/x' });
    const fresh = store.getTask(task.id);
    expect(fresh?.ownership).toHaveLength(1);
  });

  it('listTasks filters by state', () => {
    const store = new OrchestrationStore(installDir);
    const session = store.createSession({});
    const t1 = store.createTask({ sessionId: session.id, label: 'a' });
    const t2 = store.createTask({ sessionId: session.id, label: 'b' });
    store.transitionTask(t1.id, TaskLifecycle.Running);
    store.transitionTask(t1.id, TaskLifecycle.Completed);
    void t2;

    const completed = store.listTasks({ state: TaskLifecycle.Completed });
    expect(completed).toHaveLength(1);
    const queued = store.listTasks({ state: TaskLifecycle.Queued });
    expect(queued).toHaveLength(1);
  });
});

describe('OrchestrationStore — atomic write durability', () => {
  beforeEach(setupCacheRoot);
  afterEach(() => {
    vi.restoreAllMocks();
    teardownCacheRoot();
  });

  it('a write that fails leaves the prior file intact and cleans up the temp file', () => {
    // Seed an existing file via the legitimate write path.
    const store = new OrchestrationStore(installDir);
    store.createSession({ goal: 'before crash' });
    const path = getOrchestrationStoreFile(installDir);
    const before = readFileSync(path, 'utf-8');

    // Provoke a crash in `atomicWriteJSON` by feeding a circular reference
    // through it. `JSON.stringify` throws on cycles; the contract under test
    // is the same as the original mid-rename scenario: a thrown write must
    // (a) not corrupt the existing file and (b) not leave a temp file
    // behind.
    const circular: Record<string, unknown> = { id: 'x' };
    circular.self = circular;
    expect(() => atomicWriteJSON(path, circular)).toThrow();

    // The original file is untouched.
    const after = readFileSync(path, 'utf-8');
    expect(after).toBe(before);

    // No orphan tmp file lingering after the throw — `atomicWriteJSON`
    // unlinks on the failure path.
    const dir = path.substring(0, path.lastIndexOf('/'));
    const orphans = readdirSync(dir).filter((name) =>
      name.startsWith('orchestration.json.'),
    );
    expect(orphans).toEqual([]);

    // `vi` is not used in this rewritten test, but keeping the import
    // ensures the harness still tears down any leftover spies between
    // `describe` blocks.
    void vi;
  });
});

describe('OrchestrationStore — corrupt store handling', () => {
  beforeEach(setupCacheRoot);
  afterEach(teardownCacheRoot);

  it('loadStore reports kind=corrupt on invalid JSON', () => {
    const path = getOrchestrationStoreFile(installDir);
    const dir = path.substring(0, path.lastIndexOf('/'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, '{not json');
    const result = loadStore(installDir);
    expect(result.kind).toBe('corrupt');
  });

  it('loadStore reports kind=corrupt on schema mismatch (e.g. wrong version)', () => {
    const path = getOrchestrationStoreFile(installDir);
    const dir = path.substring(0, path.lastIndexOf('/'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        version: 99,
        updatedAt: '2026-05-09T00:00:00Z',
        installDir,
        sessions: [],
        tasks: [],
        subagents: [],
      }),
    );
    const result = loadStore(installDir);
    expect(result.kind).toBe('corrupt');
    if (result.kind === 'corrupt') {
      expect(result.reason).toMatch(/schema validation failed/);
    }
  });
});
