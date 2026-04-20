/**
 * Bet 2 Slice 4 — UserPromptSubmit hydrates recovery note from a persisted
 * PreCompact snapshot.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../observability', () => ({
  getRunId: () => 'run-abc',
  getAttemptId: () => 'att-hydrate',
}));

vi.mock('../../utils/debug', () => ({
  logToFile: vi.fn(),
}));

import {
  AgentState,
  buildRecoveryNote,
  consumeSnapshot,
  loadSnapshot,
  type SerializedAgentState,
} from '../agent-state';
import { createUserPromptSubmitHook } from '../agent-interface';

const snapshotPath = () =>
  join(tmpdir(), `amplitude-wizard-state-att-hydrate.json`);

function seedSnapshot(overrides: Partial<SerializedAgentState> = {}): void {
  const snap: SerializedAgentState = {
    schema: 'amplitude-wizard-agent-state/1',
    runId: 'run-abc',
    attemptId: 'att-hydrate',
    timestamp: '2026-04-18T00:00:00.000Z',
    modifiedFiles: ['/project/src/a.ts', '/project/src/b.ts'],
    lastStatus: { code: 'instrumenting', detail: 'Writing track calls' },
    compactionCount: 1,
    ...overrides,
  };
  writeFileSync(snapshotPath(), JSON.stringify(snap), { mode: 0o600 });
}

function cleanup() {
  const path = snapshotPath();
  if (existsSync(path)) rmSync(path);
}

describe('buildRecoveryNote', () => {
  it('renders a structured block naming the modified files', () => {
    const note = buildRecoveryNote({
      schema: 'amplitude-wizard-agent-state/1',
      runId: 'r',
      attemptId: 'a',
      timestamp: 't',
      modifiedFiles: ['/x.ts', '/y.ts'],
      lastStatus: { code: 'status-loaded', detail: 'ok' },
      compactionCount: 2,
    });
    expect(note).toContain('<post-compaction-recovery>');
    expect(note).toContain('2x compaction');
    expect(note).toContain('/x.ts');
    expect(note).toContain('/y.ts');
    expect(note).toContain('[status-loaded] ok');
    expect(note).toContain('</post-compaction-recovery>');
  });

  it('handles the no-files case explicitly', () => {
    const note = buildRecoveryNote({
      schema: 'amplitude-wizard-agent-state/1',
      runId: 'r',
      attemptId: 'a',
      timestamp: 't',
      modifiedFiles: [],
      lastStatus: null,
      compactionCount: 1,
    });
    expect(note).toContain('No files have been modified yet');
  });
});

describe('loadSnapshot + consumeSnapshot', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('returns null when the file does not exist', () => {
    expect(loadSnapshot(snapshotPath())).toBeNull();
  });

  it('returns null on schema mismatch', () => {
    writeFileSync(
      snapshotPath(),
      JSON.stringify({ schema: 'other', modifiedFiles: [] }),
    );
    expect(loadSnapshot(snapshotPath())).toBeNull();
  });

  it('consumeSnapshot deletes the file after a successful read', () => {
    seedSnapshot();
    expect(existsSync(snapshotPath())).toBe(true);
    const snap = consumeSnapshot(snapshotPath());
    expect(snap).not.toBeNull();
    expect(existsSync(snapshotPath())).toBe(false);
  });
});

describe('createUserPromptSubmitHook', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('returns additionalContext when a snapshot exists', async () => {
    seedSnapshot();
    const state = new AgentState();
    const hook = createUserPromptSubmitHook(state);
    const result = await hook({ prompt: 'continue instrumenting' }, undefined, {
      signal: new AbortController().signal,
    });
    expect(result.hookSpecificOutput).toMatchObject({
      hookEventName: 'UserPromptSubmit',
    });
    const ctx = (
      result.hookSpecificOutput as { additionalContext?: string } | undefined
    )?.additionalContext;
    expect(ctx).toContain('<post-compaction-recovery>');
    expect(ctx).toContain('/project/src/a.ts');
    // Snapshot consumed — second call is a no-op
    const second = await hook({ prompt: 'again' }, undefined, {
      signal: new AbortController().signal,
    });
    expect(second).toEqual({});
  });

  it('is a no-op when no snapshot is present', async () => {
    const state = new AgentState();
    const hook = createUserPromptSubmitHook(state);
    const result = await hook({ prompt: 'anything' }, undefined, {
      signal: new AbortController().signal,
    });
    expect(result).toEqual({});
  });
});
