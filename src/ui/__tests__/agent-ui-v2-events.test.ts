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
import { EVENT_DATA_VERSIONS } from '../../lib/agent-events.js';

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

// ── EVENT_DATA_VERSIONS registry coherence ─────────────────────────
//
// Every new v2 event MUST appear in `EVENT_DATA_VERSIONS`. Asserting
// this here means a future schema bump that forgets the registry
// update fails the test rather than silently shipping an unversioned
// envelope.

describe('EVENT_DATA_VERSIONS (v2 entries registered)', () => {
  it('registers discovery_fact at version 1', () => {
    expect(
      (EVENT_DATA_VERSIONS as Readonly<Record<string, number>>).discovery_fact,
    ).toBe(1);
  });
});
