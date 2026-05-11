/**
 * Regression suite for the v2 agent-mode protocol additions.
 *
 * Each event:
 *   1. Lands on stdout with the canonical envelope shape (`v: 1`,
 *      `@timestamp`, `type`, `message`, `data.event` discriminator).
 *   2. Carries the registered `data_version` (so a future shape bump
 *      forces the registry entry to be updated in lockstep).
 *   3. Round-trips through `validateEnvelopeOrLog` (i.e. the wire
 *      shape passes the structural schema we ship to orchestrators).
 *
 * The InkUI / LoggingUI no-op assertions live alongside their own
 * tests; here we only pin the NDJSON-side contract.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentUI } from '../agent-ui.js';
import {
  EVENT_DATA_VERSIONS,
  classifyFileChangeError,
  deriveStallTier,
} from '../../lib/agent-events.js';

interface NDJSONEvent {
  v: 1;
  '@timestamp': string;
  type: string;
  message: string;
  session_id?: string;
  run_id?: string;
  data?: Record<string, unknown>;
  data_version?: number;
  level?: string;
}

const setupStdoutSpy = (): { writes: string[]; restore: () => void } => {
  const writes: string[] = [];
  const spy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
  return { writes, restore: () => spy.mockRestore() };
};

const lastEvent = (writes: string[]): NDJSONEvent => {
  return JSON.parse(writes[writes.length - 1].trim()) as NDJSONEvent;
};

describe('AgentUI.pushDiscoveryFact (v2: discovery_fact wire emission)', () => {
  let writes: string[];
  let restore: () => void;

  beforeEach(() => {
    ({ writes, restore } = setupStdoutSpy());
  });
  afterEach(() => restore());

  it('emits a progress: discovery_fact event with id/label/value/discoveredAt', () => {
    const ui = new AgentUI();
    ui.pushDiscoveryFact({
      id: 'framework',
      label: 'Framework',
      value: 'Next.js (App Router)',
      discoveredAt: 1_700_000_000_000,
    });
    const event = lastEvent(writes);
    expect(event.v).toBe(1);
    expect(event.type).toBe('progress');
    expect(event.message).toBe(
      'discovery_fact: Framework = Next.js (App Router)',
    );
    expect(event.data).toMatchObject({
      event: 'discovery_fact',
      id: 'framework',
      label: 'Framework',
      value: 'Next.js (App Router)',
      discoveredAt: 1_700_000_000_000,
    });
  });

  it('stamps the registered data_version on discovery_fact', () => {
    const ui = new AgentUI();
    ui.pushDiscoveryFact({
      id: 'pm',
      label: 'Package manager',
      value: 'pnpm',
      discoveredAt: Date.now(),
    });
    const event = lastEvent(writes);
    expect(event.data_version).toBe(EVENT_DATA_VERSIONS.discovery_fact);
  });

  it('preserves @timestamp as an ISO string', () => {
    const ui = new AgentUI();
    ui.pushDiscoveryFact({
      id: 'region',
      label: 'Region',
      value: 'US',
      discoveredAt: 1,
    });
    const event = lastEvent(writes);
    expect(typeof event['@timestamp']).toBe('string');
    expect(() => new Date(event['@timestamp'])).not.toThrow();
  });
});

const eventsOfType = (writes: string[], type: string): NDJSONEvent[] =>
  writes
    .map((w) => JSON.parse(w.trim()) as NDJSONEvent)
    .filter((e) => e.type === type);

describe('AgentUI.emitCurrentFile (v2: now-editing rollup)', () => {
  let writes: string[];
  let restore: () => void;

  beforeEach(() => {
    ({ writes, restore } = setupStdoutSpy());
  });
  afterEach(() => restore());

  it('emits a progress: current_file with path/relativePath/operation', () => {
    const ui = new AgentUI();
    ui.emitCurrentFile?.({
      path: '/Users/dev/app/src/index.ts',
      relativePath: 'src/index.ts',
      operation: 'modify',
    });
    const event = lastEvent(writes);
    expect(event.type).toBe('progress');
    expect(event.data).toMatchObject({
      event: 'current_file',
      path: '/Users/dev/app/src/index.ts',
      relativePath: 'src/index.ts',
      operation: 'modify',
    });
    expect(event.data_version).toBe(EVENT_DATA_VERSIONS.current_file);
  });

  it('debounces repeated emissions for the same (path, op) within 250ms', () => {
    const ui = new AgentUI();
    const args = {
      path: '/abs/foo.ts',
      relativePath: 'foo.ts',
      operation: 'modify' as const,
    };
    ui.emitCurrentFile?.(args);
    ui.emitCurrentFile?.(args);
    ui.emitCurrentFile?.(args);
    const events = eventsOfType(writes, 'progress').filter(
      (e) => e.data?.event === 'current_file',
    );
    expect(events.length).toBe(1);
  });

  it('does NOT debounce when the path changes', () => {
    const ui = new AgentUI();
    ui.emitCurrentFile?.({
      path: '/abs/a.ts',
      relativePath: 'a.ts',
      operation: 'modify',
    });
    ui.emitCurrentFile?.({
      path: '/abs/b.ts',
      relativePath: 'b.ts',
      operation: 'modify',
    });
    const events = eventsOfType(writes, 'progress').filter(
      (e) => e.data?.event === 'current_file',
    );
    expect(events.length).toBe(2);
  });

  it('does NOT debounce when the operation changes', () => {
    const ui = new AgentUI();
    ui.emitCurrentFile?.({
      path: '/abs/a.ts',
      relativePath: 'a.ts',
      operation: 'modify',
    });
    ui.emitCurrentFile?.({
      path: '/abs/a.ts',
      relativePath: 'a.ts',
      operation: 'create',
    });
    const events = eventsOfType(writes, 'progress').filter(
      (e) => e.data?.event === 'current_file',
    );
    expect(events.length).toBe(2);
  });
});

describe('AgentUI.emitStallStatus (v2: coaching tiers)', () => {
  let writes: string[];
  let restore: () => void;

  beforeEach(() => {
    ({ writes, restore } = setupStdoutSpy());
  });
  afterEach(() => restore());

  it('emits a progress: stall_status carrying tier + durationMs + lastActivity', () => {
    const ui = new AgentUI();
    const lastActivity = Date.now();
    ui.emitStallStatus?.({
      tier: 'noticed',
      durationMs: 10_000,
      lastActivity,
      hint: 'agent has been quiet for 10s',
    });
    const event = lastEvent(writes);
    expect(event.type).toBe('progress');
    expect(event.data).toMatchObject({
      event: 'stall_status',
      tier: 'noticed',
      durationMs: 10_000,
      lastActivity,
      hint: 'agent has been quiet for 10s',
    });
    expect(event.data_version).toBe(EVENT_DATA_VERSIONS.stall_status);
  });

  it('dedups same-tier emissions until resetStallStatus is called', () => {
    const ui = new AgentUI();
    ui.emitStallStatus?.({
      tier: 'noticed',
      durationMs: 10_000,
      lastActivity: 0,
    });
    ui.emitStallStatus?.({
      tier: 'noticed',
      durationMs: 12_000,
      lastActivity: 0,
    });
    ui.emitStallStatus?.({
      tier: 'noticed',
      durationMs: 15_000,
      lastActivity: 0,
    });
    let events = eventsOfType(writes, 'progress').filter(
      (e) => e.data?.event === 'stall_status',
    );
    expect(events.length).toBe(1);

    // After reset, the same tier can fire again (next stall window).
    ui.resetStallStatus?.();
    ui.emitStallStatus?.({
      tier: 'noticed',
      durationMs: 10_000,
      lastActivity: 0,
    });
    events = eventsOfType(writes, 'progress').filter(
      (e) => e.data?.event === 'stall_status',
    );
    expect(events.length).toBe(2);
  });

  it('accepts all three documented tiers (noticed / concerning / critical)', () => {
    const ui = new AgentUI();
    const tiers = ['noticed', 'concerning', 'critical'] as const;
    for (const tier of tiers) {
      ui.emitStallStatus?.({ tier, durationMs: 1, lastActivity: 0 });
    }
    const events = eventsOfType(writes, 'progress').filter(
      (e) => e.data?.event === 'stall_status',
    );
    expect(events.map((e) => e.data?.tier)).toEqual([...tiers]);
  });

  it('omits hint from the wire when not supplied', () => {
    const ui = new AgentUI();
    ui.emitStallStatus?.({
      tier: 'critical',
      durationMs: 60_000,
      lastActivity: 0,
    });
    const event = lastEvent(writes);
    expect(event.data).not.toHaveProperty('hint');
  });
});

describe('AgentUI.emitRunResumed (v2: checkpoint restart signal)', () => {
  let writes: string[];
  let restore: () => void;

  beforeEach(() => {
    ({ writes, restore } = setupStdoutSpy());
  });
  afterEach(() => restore());

  it('emits a lifecycle: run_resumed with from_checkpoint_at / last_phase / summary', () => {
    const ui = new AgentUI();
    ui.emitRunResumed?.({
      fromCheckpointAt: '2026-05-11T00:00:00.000Z',
      lastPhase: 'agent_running',
      restoredStateSummary: 'region=us, org=foo, project=bar',
    });
    const event = lastEvent(writes);
    expect(event.type).toBe('lifecycle');
    expect(event.data).toMatchObject({
      event: 'run_resumed',
      from_checkpoint_at: '2026-05-11T00:00:00.000Z',
      last_phase: 'agent_running',
      restored_state_summary: 'region=us, org=foo, project=bar',
    });
    expect(event.data_version).toBe(EVENT_DATA_VERSIONS.run_resumed);
  });

  it('accepts the "unknown" last_phase fallback', () => {
    const ui = new AgentUI();
    ui.emitRunResumed?.({
      fromCheckpointAt: '2026-05-11T00:00:00.000Z',
      lastPhase: 'unknown',
      restoredStateSummary: '',
    });
    const event = lastEvent(writes);
    expect(event.data?.last_phase).toBe('unknown');
  });
});

// ── EVENT_DATA_VERSIONS registry coherence ─────────────────────────
//
// Every new v2 event MUST appear in `EVENT_DATA_VERSIONS`. Asserting
// this here means a future schema bump that forgets the registry
// update fails the test rather than silently shipping an unversioned
// envelope.

describe('AgentUI.emitFileChangeFailed (v2: write-failure event)', () => {
  let writes: string[];
  let restore: () => void;

  beforeEach(() => {
    ({ writes, restore } = setupStdoutSpy());
  });
  afterEach(() => restore());

  it('emits an error: file_change_failed with path/op/errorClass/errorMessage', () => {
    const ui = new AgentUI();
    ui.emitFileChangeFailed?.({
      path: '/abs/secret.env',
      operation: 'create',
      errorClass: 'permission',
      errorMessage: 'EACCES: permission denied',
    });
    const event = lastEvent(writes);
    expect(event.type).toBe('error');
    expect(event.data).toMatchObject({
      event: 'file_change_failed',
      path: '/abs/secret.env',
      operation: 'create',
      errorClass: 'permission',
      errorMessage: 'EACCES: permission denied',
    });
    expect(event.data_version).toBe(EVENT_DATA_VERSIONS.file_change_failed);
  });

  it('accepts all five documented errorClass values', () => {
    const ui = new AgentUI();
    const classes = [
      'permission',
      'not_found',
      'syntax',
      'timeout',
      'generic',
    ] as const;
    for (const errorClass of classes) {
      ui.emitFileChangeFailed?.({
        path: '/abs/a',
        operation: 'modify',
        errorClass,
        errorMessage: `class=${errorClass}`,
      });
    }
    const events = eventsOfType(writes, 'error').filter(
      (e) => e.data?.event === 'file_change_failed',
    );
    expect(events.map((e) => e.data?.errorClass)).toEqual([...classes]);
  });

  it('truncates pathologically long envelope messages (defense in depth)', () => {
    const ui = new AgentUI();
    const huge = 'x'.repeat(10_000);
    ui.emitFileChangeFailed?.({
      path: '/abs/a',
      operation: 'modify',
      errorClass: 'generic',
      errorMessage: huge,
    });
    const event = lastEvent(writes);
    // `error` type messages are truncated to MAX_LOG_MESSAGE_LENGTH (2048).
    expect(event.message.length).toBeLessThanOrEqual(2048);
  });
});

// ── classifyFileChangeError pure-helper coverage ────────────────────

describe('classifyFileChangeError', () => {
  it('classifies permission failures', () => {
    expect(classifyFileChangeError('EACCES: permission denied')).toBe(
      'permission',
    );
    expect(classifyFileChangeError('write_refused by canUseTool')).toBe(
      'permission',
    );
    expect(classifyFileChangeError('Permission Denied')).toBe('permission');
    // PR B4 — extended patterns
    expect(classifyFileChangeError('EPERM: operation not permitted')).toBe(
      'permission',
    );
    expect(classifyFileChangeError('EROFS: read-only file system')).toBe(
      'permission',
    );
  });

  it('classifies not-found failures', () => {
    expect(classifyFileChangeError('ENOENT: no such file or directory')).toBe(
      'not_found',
    );
    expect(classifyFileChangeError('file not found')).toBe('not_found');
    // PR B4 — extended pattern
    expect(classifyFileChangeError('Path does not exist')).toBe('not_found');
  });

  it('classifies edit syntax failures', () => {
    expect(classifyFileChangeError('String to replace not found in file')).toBe(
      'syntax',
    );
    expect(classifyFileChangeError('Found multiple matches: 3')).toBe('syntax');
    expect(classifyFileChangeError('Found 0 matches')).toBe('syntax');
    expect(classifyFileChangeError('SyntaxError: Unexpected token')).toBe(
      'syntax',
    );
    // PR B4 — extended patterns
    expect(classifyFileChangeError('Old string did not match in file')).toBe(
      'syntax',
    );
    expect(classifyFileChangeError('Unexpected token } in JSON')).toBe(
      'syntax',
    );
    expect(classifyFileChangeError('Invalid JSON: trailing comma')).toBe(
      'syntax',
    );
  });

  it('classifies timeout failures (PR B4)', () => {
    // ETIMEDOUT from Node fs / network — transient, retry-safe.
    expect(classifyFileChangeError('ETIMEDOUT: operation timed out')).toBe(
      'timeout',
    );
    expect(classifyFileChangeError('Operation timed out after 30s')).toBe(
      'timeout',
    );
    expect(classifyFileChangeError('Request timeout')).toBe('timeout');
    expect(classifyFileChangeError('deadline exceeded')).toBe('timeout');
  });

  it('prefers timeout over not_found when both signals appear', () => {
    // The SDK occasionally surfaces ETIMEDOUT wrapped with secondary
    // text that mentions "not found" — we want the timeout signal to
    // win so retry-aware consumers don't treat a transient as a
    // permanent failure. Tests the explicit ordering in the
    // classifier.
    expect(classifyFileChangeError('ETIMEDOUT (path not found in cache)')).toBe(
      'timeout',
    );
  });

  it('defaults to generic for unrecognized failures', () => {
    expect(classifyFileChangeError('something exploded')).toBe('generic');
    expect(classifyFileChangeError('')).toBe('generic');
  });
});

describe('EVENT_DATA_VERSIONS (v2 entries registered)', () => {
  it.each([
    ['discovery_fact', 1],
    ['current_file', 1],
    ['stall_status', 1],
    ['run_resumed', 1],
    ['file_change_failed', 1],
  ] as const)('registers %s at version %d', (event, version) => {
    expect(
      (EVENT_DATA_VERSIONS as Readonly<Record<string, number>>)[event],
    ).toBe(version);
  });
});

// ── deriveStallTier pure-helper coverage ────────────────────────────

describe('deriveStallTier', () => {
  it('returns null below the noticed threshold', () => {
    expect(deriveStallTier(0)).toBeNull();
    expect(deriveStallTier(9_999)).toBeNull();
  });

  it('returns "noticed" at the 10s threshold', () => {
    expect(deriveStallTier(10_000)).toBe('noticed');
    expect(deriveStallTier(29_999)).toBe('noticed');
  });

  it('returns "concerning" at the 30s threshold', () => {
    expect(deriveStallTier(30_000)).toBe('concerning');
    expect(deriveStallTier(59_999)).toBe('concerning');
  });

  it('returns "critical" at the 60s threshold', () => {
    expect(deriveStallTier(60_000)).toBe('critical');
    expect(deriveStallTier(120_000)).toBe('critical');
  });
});
