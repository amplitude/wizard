/**
 * Bet 2 Slice 3 — PreCompact agent-state serialization.
 *
 * Verifies AgentState accumulates modified files + last status, and persists
 * a well-formed JSON snapshot to the tmpdir path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../observability', () => ({
  getRunId: () => 'run-abc',
}));

vi.mock('../../utils/debug', () => ({
  logToFile: vi.fn(),
}));

import {
  AgentState,
  consumeSnapshot,
  loadSnapshot,
  type SerializedAgentState,
} from '../agent-state';

describe('AgentState', () => {
  let state: AgentState;
  const attemptId = 'att-xyz';
  const snapshotPath = join(
    tmpdir(),
    `amplitude-wizard-state-${attemptId}-${process.pid}.json`,
  );

  beforeEach(() => {
    state = new AgentState();
    state.setAttemptId(attemptId);
  });

  afterEach(() => {
    if (existsSync(snapshotPath)) rmSync(snapshotPath);
  });

  it('deduplicates modified files', () => {
    state.recordModifiedFile('src/a.ts');
    state.recordModifiedFile('src/a.ts');
    state.recordModifiedFile('src/b.ts');
    const snap = state.snapshot();
    expect(snap.modifiedFiles).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('sorts modified files in snapshot', () => {
    state.recordModifiedFile('src/z.ts');
    state.recordModifiedFile('src/a.ts');
    state.recordModifiedFile('src/m.ts');
    const snap = state.snapshot();
    expect(snap.modifiedFiles).toEqual(['src/a.ts', 'src/m.ts', 'src/z.ts']);
  });

  it('ignores empty file paths', () => {
    state.recordModifiedFile('');
    state.recordModifiedFile('src/ok.ts');
    expect(state.snapshot().modifiedFiles).toEqual(['src/ok.ts']);
  });

  it('tracks last status message', () => {
    state.recordStatus('WIZARD_SETUP_SDK', 'Installing dependencies');
    state.recordStatus('WIZARD_SETUP_ENV_VAR', 'Writing .env.local');
    expect(state.snapshot().lastStatus).toEqual({
      code: 'WIZARD_SETUP_ENV_VAR',
      detail: 'Writing .env.local',
    });
  });

  it('increments compaction counter', () => {
    expect(state.snapshot().compactionCount).toBe(0);
    state.recordCompaction();
    state.recordCompaction();
    state.recordCompaction();
    expect(state.snapshot().compactionCount).toBe(3);
  });

  it('includes run id and attempt id in snapshot', () => {
    const snap = state.snapshot();
    expect(snap.runId).toBe('run-abc');
    expect(snap.attemptId).toBe(attemptId);
  });

  it('uses the schema-versioned envelope', () => {
    const snap = state.snapshot();
    expect(snap.schemaVersion).toBe('amplitude-wizard-agent-state/1');
  });

  it('persists a JSON snapshot to the tmpdir path', () => {
    state.recordModifiedFile('src/tools/foo.ts');
    state.recordStatus('STATUS_CODE', 'detail');
    state.persist();
    expect(existsSync(snapshotPath)).toBe(true);
    const parsed = JSON.parse(
      readFileSync(snapshotPath, 'utf-8'),
    ) as SerializedAgentState;
    expect(parsed.modifiedFiles).toEqual(['src/tools/foo.ts']);
    expect(parsed.lastStatus).toEqual({
      code: 'STATUS_CODE',
      detail: 'detail',
    });
    expect(parsed.attemptId).toBe(attemptId);
    expect(parsed.persistedAt).toBeGreaterThan(0);
  });

  it('persists atomically — no leftover temp file after a successful write', () => {
    state.recordModifiedFile('src/tools/foo.ts');
    const path = state.persist();
    expect(path).not.toBeNull();
    // atomicWriteJSON writes to `${target}.${pid}.tmp` then renames.
    // After success, only the target should exist — no orphan tmp file.
    const tmpCandidate = `${snapshotPath}.${process.pid}.tmp`;
    expect(existsSync(tmpCandidate)).toBe(false);
    expect(existsSync(snapshotPath)).toBe(true);
  });

  it('snapshotPath uses the attempt id', () => {
    expect(state.snapshotPath()).toBe(snapshotPath);
  });

  it('snapshotPath includes the process pid to scope per-run', () => {
    expect(state.snapshotPath()).toContain(`-${process.pid}.json`);
  });

  it('does NOT load a stale snapshot left by a different pid', () => {
    // Simulate a crashed prior wizard run that left a snapshot using a
    // different pid suffix. The current process must not pick it up via
    // its own snapshotPath()/consumeSnapshot pair.
    const stalePid = process.pid + 1;
    const stalePath = join(
      tmpdir(),
      `amplitude-wizard-state-${attemptId}-${stalePid}.json`,
    );
    const staleSnap: SerializedAgentState = {
      schemaVersion: 'amplitude-wizard-agent-state/1',
      runId: 'run-stale',
      attemptId,
      modifiedFiles: ['/leaked/from/prior/run.ts'],
      lastStatus: null,
      compactionCount: 0,
      persistedAt: 1,
    };
    writeFileSync(stalePath, JSON.stringify(staleSnap));
    try {
      // The stale file is NOT at our pid-scoped path → loadSnapshot returns null.
      expect(loadSnapshot(state.snapshotPath())).toBeNull();
      expect(consumeSnapshot(state.snapshotPath())).toBeNull();
      // And the stale file is left alone — we only operate on our own path.
      expect(existsSync(stalePath)).toBe(true);
    } finally {
      if (existsSync(stalePath)) rmSync(stalePath);
    }
  });

  it('reset clears files, status, and compaction count', () => {
    state.recordModifiedFile('src/a.ts');
    state.recordStatus('X', 'Y');
    state.recordCompaction();
    state.reset();
    const snap = state.snapshot();
    expect(snap.modifiedFiles).toEqual([]);
    expect(snap.lastStatus).toBeNull();
    expect(snap.compactionCount).toBe(0);
  });
});
