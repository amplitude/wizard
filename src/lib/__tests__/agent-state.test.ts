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

  it('reset clears compaction count + tool-use counts (per-conversation facts)', () => {
    state.recordCompaction();
    state.recordToolUse('Read');
    state.reset();
    const snap = state.snapshot();
    expect(snap.compactionCount).toBe(0);
  });

  it('preserves modifiedFiles across reset (so retries do not overwrite prior writes)', () => {
    // Concrete reproduction of the failure mode: attempt 0 writes real
    // files, transient SDK error fires, retry kicks in. Without the
    // preservation, attempt 1 has no record of the write — it would
    // happily re-write src/foo.ts with different content. With it, the
    // path survives reset and shows up in the retry hint.
    state.recordModifiedFile('src/foo.ts');
    state.recordModifiedFile('src/bar.ts');
    state.reset();
    const snap = state.snapshot();
    expect(snap.modifiedFiles).toEqual(['src/bar.ts', 'src/foo.ts']);
  });

  it('preserves lastStatus across reset (so retries know what the user last saw)', () => {
    state.recordStatus('INSTALL_RUNNING', 'Installing @amplitude/unified');
    state.reset();
    expect(state.snapshot().lastStatus).toEqual({
      code: 'INSTALL_RUNNING',
      detail: 'Installing @amplitude/unified',
    });
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

  it('clearModifiedFiles does the hard reset', () => {
    state.recordModifiedFile('src/foo.ts');
    state.clearModifiedFiles();
    expect(state.snapshot().modifiedFiles).toEqual([]);
  });

  it('clearLastStatus does the hard reset', () => {
    state.recordStatus('X', 'Y');
    state.clearLastStatus();
    expect(state.snapshot().lastStatus).toBeNull();
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
    it('returns empty string when nothing has been recorded', () => {
      expect(buildRetryHint(state)).toBe('');
    });

    it('renders a hint block listing each discovery on its own line', () => {
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
    });

    it('lists files written by the prior attempt with explicit Read-before-rewrite guidance', () => {
      // This is the regression scenario from the wizard log: agent
      // writes real files, transient SDK error fires, retry kicks in
      // with no record of the writes. The hint must surface the file
      // list AND tell the model to Read before re-writing — otherwise
      // it'll happily overwrite with different content.
      state.recordModifiedFile('/work/src/instrumentation-client.ts');
      state.recordModifiedFile('/work/src/lib/amplitude.ts');
      const hint = buildRetryHint(state);
      expect(hint).toContain(
        'Files already written by the prior attempt (still on disk; Read them before re-writing):',
      );
      expect(hint).toContain('- /work/src/instrumentation-client.ts');
      expect(hint).toContain('- /work/src/lib/amplitude.ts');
      expect(hint).toMatch(/DO NOT overwrite files unless you Read them first/);
    });

    it('surfaces the last reported status so the model knows what the user last saw', () => {
      state.recordStatus('INSTALL_RUNNING', 'Installing @amplitude/unified');
      const hint = buildRetryHint(state);
      expect(hint).toContain(
        'Last reported status before the interruption: [INSTALL_RUNNING] Installing @amplitude/unified',
      );
    });

    it('combines all sections when all are populated', () => {
      state.recordDiscovery('Package manager (already probed)', 'pnpm');
      state.recordModifiedFile('src/init.ts');
      state.recordStatus('PROGRESS', 'Adding init code');
      const hint = buildRetryHint(state);
      // All three sections present, in deterministic order.
      const discoveryIdx = hint.indexOf('Discoveries already verified');
      const filesIdx = hint.indexOf('Files already written');
      const statusIdx = hint.indexOf('Last reported status');
      expect(discoveryIdx).toBeGreaterThan(-1);
      expect(filesIdx).toBeGreaterThan(discoveryIdx);
      expect(statusIdx).toBeGreaterThan(filesIdx);
    });
  });
});
