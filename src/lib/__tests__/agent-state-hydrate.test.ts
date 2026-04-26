/**
 * Bet 2 Slice 4 — UserPromptSubmit hydrates recovery note from a persisted
 * PreCompact snapshot.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
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
  buildRecoveryNote,
  consumeSnapshot,
  loadSnapshot,
  type SerializedAgentState,
} from '../agent-state';
import { createUserPromptSubmitHook } from '../agent-interface';
import { CACHE_ROOT_OVERRIDE_ENV } from '../../utils/storage-paths';

const ATTEMPT_ID = 'att-hydrate';

let cacheRoot: string;
let originalCacheOverride: string | undefined;

const snapshotPath = () => join(cacheRoot, 'state', `${ATTEMPT_ID}.json`);

beforeEach(() => {
  cacheRoot = mkdtempSync(join(tmpdir(), 'wiz-state-hydrate-'));
  originalCacheOverride = process.env[CACHE_ROOT_OVERRIDE_ENV];
  process.env[CACHE_ROOT_OVERRIDE_ENV] = cacheRoot;
  mkdirSync(join(cacheRoot, 'state'), { recursive: true });
});

afterEach(() => {
  rmSync(cacheRoot, { recursive: true, force: true });
  if (originalCacheOverride === undefined) {
    delete process.env[CACHE_ROOT_OVERRIDE_ENV];
  } else {
    process.env[CACHE_ROOT_OVERRIDE_ENV] = originalCacheOverride;
  }
});

function seedSnapshot(overrides: Partial<SerializedAgentState> = {}): void {
  const snap: SerializedAgentState = {
    schemaVersion: 'amplitude-wizard-agent-state/1',
    runId: 'run-abc',
    attemptId: ATTEMPT_ID,
    modifiedFiles: ['/project/src/a.ts', '/project/src/b.ts'],
    lastStatus: { code: 'instrumenting', detail: 'Writing track calls' },
    compactionCount: 1,
    persistedAt: 1_700_000_000,
    ...overrides,
  };
  writeFileSync(snapshotPath(), JSON.stringify(snap), { mode: 0o600 });
}

function cleanup() {
  const path = snapshotPath();
  if (existsSync(path)) rmSync(path);
}

describe('loadSnapshot + consumeSnapshot', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('returns null when no file exists', () => {
    expect(loadSnapshot(snapshotPath())).toBeNull();
  });

  it('round-trips a well-formed snapshot', () => {
    seedSnapshot();
    const snap = loadSnapshot(snapshotPath());
    expect(snap?.modifiedFiles).toEqual([
      '/project/src/a.ts',
      '/project/src/b.ts',
    ]);
    expect(snap?.compactionCount).toBe(1);
    expect(snap?.lastStatus?.code).toBe('instrumenting');
  });

  it('returns null when JSON is invalid', () => {
    writeFileSync(snapshotPath(), '{ not json');
    expect(loadSnapshot(snapshotPath())).toBeNull();
  });

  it('returns null when shape fails validation', () => {
    writeFileSync(
      snapshotPath(),
      JSON.stringify({ schemaVersion: 'amplitude-wizard-agent-state/1' }),
    );
    expect(loadSnapshot(snapshotPath())).toBeNull();
  });

  it('consumeSnapshot deletes the file after reading', () => {
    seedSnapshot();
    expect(existsSync(snapshotPath())).toBe(true);
    const snap = consumeSnapshot(snapshotPath());
    expect(snap).not.toBeNull();
    expect(existsSync(snapshotPath())).toBe(false);
  });

  it('consumeSnapshot returns null when no file exists', () => {
    expect(consumeSnapshot(snapshotPath())).toBeNull();
  });
});

describe('buildRecoveryNote', () => {
  it('includes compaction count, files, and last status', () => {
    const snap: SerializedAgentState = {
      schemaVersion: 'amplitude-wizard-agent-state/1',
      runId: 'r',
      attemptId: 'a',
      modifiedFiles: ['/x.ts', '/y.ts'],
      lastStatus: { code: 'planning', detail: 'Mapping events' },
      compactionCount: 2,
      persistedAt: 0,
    };
    const note = buildRecoveryNote(snap);
    expect(note).toContain('2x compaction');
    expect(note).toContain('/x.ts');
    expect(note).toContain('/y.ts');
    expect(note).toContain('[planning] Mapping events');
    expect(note).toMatch(/^<post-compaction-recovery>/);
    expect(note.trimEnd()).toMatch(/<\/post-compaction-recovery>$/);
  });

  it('handles no files + no last status', () => {
    const snap: SerializedAgentState = {
      schemaVersion: 'amplitude-wizard-agent-state/1',
      runId: 'r',
      attemptId: 'a',
      modifiedFiles: [],
      lastStatus: null,
      compactionCount: 1,
      persistedAt: 0,
    };
    const note = buildRecoveryNote(snap);
    expect(note).toContain('No files have been modified');
    expect(note).not.toContain('Last reported status');
  });
});

describe('createUserPromptSubmitHook', () => {
  let state: AgentState;

  beforeEach(() => {
    cleanup();
    state = new AgentState();
    state.setAttemptId(ATTEMPT_ID);
  });

  afterEach(cleanup);

  it('returns {} when no snapshot is present', async () => {
    const hook = createUserPromptSubmitHook(state);
    const out = await hook({}, undefined, {
      signal: new AbortController().signal,
    });
    expect(out).toEqual({});
  });

  it('injects additionalContext when snapshot exists and deletes the file', async () => {
    seedSnapshot();
    const hook = createUserPromptSubmitHook(state);
    const out = (await hook({}, undefined, {
      signal: new AbortController().signal,
    })) as {
      hookSpecificOutput?: {
        hookEventName: string;
        additionalContext: string;
      };
    };
    expect(out.hookSpecificOutput?.hookEventName).toBe('UserPromptSubmit');
    expect(out.hookSpecificOutput?.additionalContext).toContain(
      '/project/src/a.ts',
    );
    expect(existsSync(snapshotPath())).toBe(false);
  });

  it('only hydrates once per compaction cycle', async () => {
    seedSnapshot();
    const hook = createUserPromptSubmitHook(state);
    const first = await hook({}, undefined, {
      signal: new AbortController().signal,
    });
    const second = await hook({}, undefined, {
      signal: new AbortController().signal,
    });
    expect(first).toHaveProperty('hookSpecificOutput');
    expect(second).toEqual({});
  });
});
