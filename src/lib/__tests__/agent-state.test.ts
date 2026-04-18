/**
 * Bet 2 Slice 3 — PreCompact agent-state serialization.
 *
 * Verifies AgentState accumulates modified files + last status, and the
 * PreCompact hook writes a well-formed JSON snapshot to the tmpdir path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../observability', () => ({
  getRunId: () => 'run-abc',
  getAttemptId: () => 'att-xyz',
}));

vi.mock('../../utils/debug', () => ({
  logToFile: vi.fn(),
}));

import { AgentState, type SerializedAgentState } from '../agent-state';
import { ToolCallCounters } from '../tool-call-counters';
import {
  createPreCompactHook,
  createPostToolUseHook,
} from '../agent-interface';

describe('AgentState', () => {
  let state: AgentState;

  beforeEach(() => {
    state = new AgentState();
  });

  afterEach(() => {
    const path = join(tmpdir(), `amplitude-wizard-state-att-xyz.json`);
    if (existsSync(path)) rmSync(path);
  });

  it('dedups modified-file paths and sorts them', () => {
    state.recordModifiedFile('/project/b.ts');
    state.recordModifiedFile('/project/a.ts');
    state.recordModifiedFile('/project/a.ts');
    const snap = state.snapshot();
    expect(snap.modifiedFiles).toEqual(['/project/a.ts', '/project/b.ts']);
  });

  it('tracks the most recent status', () => {
    state.recordStatus('skill-loaded', 'Loaded integration-nextjs-app-router');
    state.recordStatus('instrumenting', 'Writing track() calls');
    expect(state.snapshot().lastStatus).toEqual({
      code: 'instrumenting',
      detail: 'Writing track() calls',
    });
  });

  it('increments compactionCount', () => {
    state.recordCompaction();
    state.recordCompaction();
    expect(state.snapshot().compactionCount).toBe(2);
  });

  it('writes a valid JSON snapshot on persist()', () => {
    state.recordModifiedFile('/project/pages/_app.tsx');
    state.recordStatus(
      'sdk-installed',
      'Installed @amplitude/analytics-browser',
    );
    const path = state.persist();
    expect(path).not.toBeNull();
    const raw = readFileSync(path!, 'utf8');
    const parsed = JSON.parse(raw) as SerializedAgentState;
    expect(parsed.schema).toBe('amplitude-wizard-agent-state/1');
    expect(parsed.runId).toBe('run-abc');
    expect(parsed.attemptId).toBe('att-xyz');
    expect(parsed.modifiedFiles).toEqual(['/project/pages/_app.tsx']);
    expect(parsed.lastStatus).toEqual({
      code: 'sdk-installed',
      detail: 'Installed @amplitude/analytics-browser',
    });
  });

  it('snapshot path includes the current attempt id', () => {
    expect(state.serializationPath()).toContain('att-xyz');
  });
});

describe('createPreCompactHook + AgentState', () => {
  let state: AgentState;
  let counters: ToolCallCounters;

  beforeEach(() => {
    counters = new ToolCallCounters();
    state = new AgentState();
  });

  afterEach(() => {
    const path = join(tmpdir(), `amplitude-wizard-state-att-xyz.json`);
    if (existsSync(path)) rmSync(path);
  });

  it('persists agent state when a compaction fires', async () => {
    state.recordModifiedFile('/project/track.ts');
    const hook = createPreCompactHook(counters, state);

    await hook({}, undefined, { signal: new AbortController().signal });

    expect(counters.snapshot().compactions).toBe(1);
    expect(state.snapshot().compactionCount).toBe(1);
    const persistedPath = join(tmpdir(), `amplitude-wizard-state-att-xyz.json`);
    expect(existsSync(persistedPath)).toBe(true);
    const parsed = JSON.parse(
      readFileSync(persistedPath, 'utf8'),
    ) as SerializedAgentState;
    expect(parsed.modifiedFiles).toContain('/project/track.ts');
  });

  it('is a no-op on AgentState when state arg is omitted', async () => {
    const hook = createPreCompactHook(counters);
    await hook({}, undefined, { signal: new AbortController().signal });
    expect(counters.snapshot().compactions).toBe(1);
    const persistedPath = join(tmpdir(), `amplitude-wizard-state-att-xyz.json`);
    expect(existsSync(persistedPath)).toBe(false);
  });
});

describe('createPostToolUseHook + AgentState', () => {
  let counters: ToolCallCounters;
  let state: AgentState;

  beforeEach(() => {
    counters = new ToolCallCounters();
    state = new AgentState();
  });

  it('records file_path on Write', async () => {
    const hook = createPostToolUseHook(counters, state);
    await hook(
      { tool_name: 'Write', tool_input: { file_path: '/project/src/a.ts' } },
      undefined,
      { signal: new AbortController().signal },
    );
    expect(state.snapshot().modifiedFiles).toContain('/project/src/a.ts');
  });

  it('records file_path on Edit', async () => {
    const hook = createPostToolUseHook(counters, state);
    await hook(
      { tool_name: 'Edit', tool_input: { file_path: '/project/src/b.ts' } },
      undefined,
      { signal: new AbortController().signal },
    );
    expect(state.snapshot().modifiedFiles).toContain('/project/src/b.ts');
  });

  it('ignores non-file-mutating tools', async () => {
    const hook = createPostToolUseHook(counters, state);
    await hook(
      { tool_name: 'Read', tool_input: { file_path: '/project/src/c.ts' } },
      undefined,
      { signal: new AbortController().signal },
    );
    expect(state.snapshot().modifiedFiles).toEqual([]);
  });

  it('still increments the tool-call counter even when state is omitted', async () => {
    const hook = createPostToolUseHook(counters);
    await hook(
      { tool_name: 'Write', tool_input: { file_path: '/project/x.ts' } },
      undefined,
      { signal: new AbortController().signal },
    );
    expect(counters.snapshot().toolCallsTotal).toBe(1);
  });
});
