/**
 * Bet 2 Slice 3 — PreCompact agent-state serialization.
 *
 * Verifies AgentState accumulates modified files + last status, and persists
 * a well-formed JSON snapshot to the cache-root path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  buildRetryHint,
  type SerializedAgentState,
} from '../agent-state';
import { CACHE_ROOT_OVERRIDE_ENV } from '../../utils/storage-paths';

describe('AgentState', () => {
  let state: AgentState;
  let cacheRoot: string;
  let originalOverride: string | undefined;
  const attemptId = 'att-xyz';
  let snapshotPath: string;

  beforeEach(() => {
    cacheRoot = mkdtempSync(join(tmpdir(), 'wiz-state-cache-'));
    originalOverride = process.env[CACHE_ROOT_OVERRIDE_ENV];
    process.env[CACHE_ROOT_OVERRIDE_ENV] = cacheRoot;
    snapshotPath = join(cacheRoot, 'state', `${attemptId}-${process.pid}.json`);
    state = new AgentState();
    state.setAttemptId(attemptId);
  });

  afterEach(() => {
    if (existsSync(snapshotPath)) rmSync(snapshotPath);
    rmSync(cacheRoot, { recursive: true, force: true });
    if (originalOverride === undefined) {
      delete process.env[CACHE_ROOT_OVERRIDE_ENV];
    } else {
      process.env[CACHE_ROOT_OVERRIDE_ENV] = originalOverride;
    }
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

  it('snapshotPath uses the attempt id', () => {
    expect(state.snapshotPath()).toBe(snapshotPath);
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

  it('preserves discovery facts across reset (so retries can skip prior probes)', () => {
    state.recordDiscovery(
      'Package manager (already probed)',
      'pnpm (lockfile: pnpm-lock.yaml)',
    );
    state.recordDiscovery('Skill loaded', 'integration-nextjs-pages-router');
    state.reset();
    expect(state.getDiscoveries().size).toBe(2);
    expect(state.getDiscoveries().get('Skill loaded')).toBe(
      'integration-nextjs-pages-router',
    );
  });

  it('clearDiscoveries does the hard reset', () => {
    state.recordDiscovery('Package manager (already probed)', 'pnpm');
    state.clearDiscoveries();
    expect(state.getDiscoveries().size).toBe(0);
  });

  it('drops empty / oversized discovery summaries to keep the retry hint compact', () => {
    state.recordDiscovery('empty', '   ');
    state.recordDiscovery('big', 'x'.repeat(500));
    state.recordDiscovery('ok', 'pnpm');
    expect([...state.getDiscoveries().keys()]).toEqual(['ok']);
  });

  describe('buildRetryHint', () => {
    it('returns empty string when no discoveries are recorded', () => {
      expect(buildRetryHint(state)).toBe('');
    });

    it('renders a short hint block listing each discovery on its own line', () => {
      state.recordDiscovery(
        'Package manager (already probed)',
        'pnpm (pnpm-lock.yaml)',
      );
      state.recordDiscovery('Skill loaded', 'integration-nextjs-pages-router');
      const hint = buildRetryHint(state);
      expect(hint).toContain('<retry-recovery>');
      expect(hint).toContain('</retry-recovery>');
      expect(hint).toContain(
        '- Package manager (already probed): pnpm (pnpm-lock.yaml)',
      );
      expect(hint).toContain('- Skill loaded: integration-nextjs-pages-router');
      // Bias toward terseness — the hint shouldn't bloat past a handful of lines.
      expect(hint.split('\n').length).toBeLessThan(15);
    });
  });
});
