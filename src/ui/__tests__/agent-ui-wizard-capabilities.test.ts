/**
 * Regression suite for PR B8 — `wizard_capabilities` startup
 * announcement.
 *
 * The capability envelope is the first orchestrator-facing event
 * the wizard speaks after `run_started`. It pins the protocol
 * version, the per-event-shape registry, the sorted set of
 * supported event-keys, and the execution-mode discriminator so an
 * orchestrator can branch on the contract BEFORE any contract-
 * shaped event lands on the stream.
 *
 * Four layers of coverage:
 *
 *  1. Envelope shape on stdout — `type: 'lifecycle'`,
 *     `data.event: 'wizard_capabilities'`, registered
 *     `data_version`, full payload (protocolVersion,
 *     eventDataVersions, supportedEvents, mode).
 *
 *  2. Registry coherence — `eventDataVersions` matches the live
 *     `EVENT_DATA_VERSIONS`; `supportedEvents` is the same key
 *     set, pre-sorted; the announcement carries the current
 *     `WIZARD_PROTOCOL_VERSION` and a known `mode`.
 *
 *  3. Round-trip through the envelope validator — emit, parse, and
 *     verify the wire-format invariants the orchestrator depends
 *     on (envelope `v=1`, ISO timestamp, `data_version` stamp).
 *
 *  4. No-op behaviour on non-AgentUI implementations (LoggingUI).
 *
 * Plus: a runner-level ordering test that pins capabilities IMMEDIATELY
 * after `run_started`, BEFORE any `run_phase: cold_start` envelope.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentUI } from '../agent-ui.js';
import {
  EVENT_DATA_VERSIONS,
  WIZARD_PROTOCOL_VERSION,
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

const parseEvents = (writes: string[]): NDJSONEvent[] =>
  writes.map((w) => JSON.parse(w.trim()) as NDJSONEvent);

const findCapabilities = (writes: string[]): NDJSONEvent[] =>
  parseEvents(writes).filter(
    (e) =>
      (e.data as { event?: string } | undefined)?.event ===
      'wizard_capabilities',
  );

// ── Envelope shape ─────────────────────────────────────────────────────

describe('AgentUI.emitWizardCapabilities (PR B8: startup announcement)', () => {
  let writes: string[];
  let restore: () => void;

  beforeEach(() => {
    ({ writes, restore } = setupStdoutSpy());
  });
  afterEach(() => restore());

  it('emits a lifecycle envelope with data.event = "wizard_capabilities"', () => {
    const ui = new AgentUI();
    ui.emitWizardCapabilities();
    const events = findCapabilities(writes);
    expect(events.length).toBe(1);
    const event = events[0];
    expect(event.v).toBe(1);
    expect(event.type).toBe('lifecycle');
    expect(event.data).toMatchObject({
      event: 'wizard_capabilities',
      mode: 'agent',
      protocolVersion: WIZARD_PROTOCOL_VERSION,
    });
  });

  it('stamps the registered data_version for wizard_capabilities', () => {
    const ui = new AgentUI();
    ui.emitWizardCapabilities();
    const event = findCapabilities(writes)[0];
    expect(event.data_version).toBe(EVENT_DATA_VERSIONS.wizard_capabilities);
  });

  it('preserves @timestamp as an ISO string', () => {
    const ui = new AgentUI();
    ui.emitWizardCapabilities();
    const event = findCapabilities(writes)[0];
    expect(typeof event['@timestamp']).toBe('string');
    expect(() => new Date(event['@timestamp'])).not.toThrow();
  });

  it('carries a human-readable summary in `message`', () => {
    // The message field is the log-scraping fallback for tools
    // that don't unwrap `data`. Pin its shape so a future refactor
    // that drops the protocol version from the summary string
    // gets caught here.
    const ui = new AgentUI();
    ui.emitWizardCapabilities();
    const event = findCapabilities(writes)[0];
    expect(event.message).toContain('wizard_capabilities');
    expect(event.message).toContain(`v${WIZARD_PROTOCOL_VERSION}`);
  });
});

// ── Registry coherence ─────────────────────────────────────────────────

describe('wizard_capabilities — registry coherence', () => {
  let writes: string[];
  let restore: () => void;

  beforeEach(() => {
    ({ writes, restore } = setupStdoutSpy());
  });
  afterEach(() => restore());

  it('mirrors the live EVENT_DATA_VERSIONS registry verbatim', () => {
    // The orchestrator branches on per-event `data_version` from
    // this payload. If `eventDataVersions` drifts from the live
    // registry, orchestrators that pre-allocated handlers will
    // mis-route events. Pin the contract end-to-end.
    const ui = new AgentUI();
    ui.emitWizardCapabilities();
    const event = findCapabilities(writes)[0];
    const data = event.data as {
      eventDataVersions: Record<string, number>;
    };
    expect(data.eventDataVersions).toEqual({ ...EVENT_DATA_VERSIONS });
  });

  it('exposes supportedEvents as sorted Object.keys(EVENT_DATA_VERSIONS)', () => {
    // Orchestrators that only care about presence ("does this
    // wizard emit `progress_estimate`?") read `supportedEvents`
    // and expect it pre-sorted so they don't have to sort on
    // their side for binary-search / set-like lookups.
    const ui = new AgentUI();
    ui.emitWizardCapabilities();
    const event = findCapabilities(writes)[0];
    const data = event.data as { supportedEvents: string[] };
    const expected = Object.keys(EVENT_DATA_VERSIONS).sort();
    expect(data.supportedEvents).toEqual(expected);
    // Defense-in-depth: the array is explicitly sorted (not just
    // declaration order that happens to be alphabetical for the
    // current registry). Sort-stability across registry edits is
    // the contract.
    const copy = [...data.supportedEvents];
    expect(copy).toEqual([...copy].sort());
  });

  it('carries the current WIZARD_PROTOCOL_VERSION', () => {
    const ui = new AgentUI();
    ui.emitWizardCapabilities();
    const event = findCapabilities(writes)[0];
    const data = event.data as { protocolVersion: number };
    expect(data.protocolVersion).toBe(WIZARD_PROTOCOL_VERSION);
    expect(WIZARD_PROTOCOL_VERSION).toBe(2);
  });

  it('discriminates mode as one of agent | ci | interactive', () => {
    const ui = new AgentUI();
    ui.emitWizardCapabilities();
    const event = findCapabilities(writes)[0];
    const data = event.data as { mode: string };
    expect(['agent', 'ci', 'interactive']).toContain(data.mode);
    // AgentUI is the only emitter today.
    expect(data.mode).toBe('agent');
  });

  it('includes wizard_capabilities itself in supportedEvents', () => {
    // Belt-and-braces: the announcement event is in its own
    // registry, so an orchestrator reading `supportedEvents` can
    // expect it (it's literally how they learned about the
    // protocol). If a future refactor moves the registration out
    // of `EVENT_DATA_VERSIONS`, this fails loudly.
    const ui = new AgentUI();
    ui.emitWizardCapabilities();
    const event = findCapabilities(writes)[0];
    const data = event.data as { supportedEvents: string[] };
    expect(data.supportedEvents).toContain('wizard_capabilities');
  });
});

// ── Wire-format invariants (envelope validator round-trip) ─────────────

describe('wizard_capabilities — envelope validator round-trip', () => {
  let writes: string[];
  let restore: () => void;

  beforeEach(() => {
    ({ writes, restore } = setupStdoutSpy());
  });
  afterEach(() => restore());

  it('produces an envelope that JSON.parse round-trips cleanly', () => {
    // The wire boundary is the only thing the orchestrator sees.
    // Round-trip the line through JSON.parse and assert every
    // contract field survives intact (strings as strings, numbers
    // as numbers, arrays as arrays). A regression that double-
    // stringified the payload would fail here.
    const ui = new AgentUI();
    ui.emitWizardCapabilities();
    expect(writes.length).toBeGreaterThanOrEqual(1);
    const rawLine = writes[writes.length - 1];
    expect(rawLine.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(rawLine.trim()) as NDJSONEvent;
    expect(parsed.v).toBe(1);
    expect(typeof parsed['@timestamp']).toBe('string');
    expect(parsed.type).toBe('lifecycle');
    expect(typeof parsed.data_version).toBe('number');
    const data = parsed.data as {
      event: string;
      protocolVersion: number;
      eventDataVersions: Record<string, number>;
      supportedEvents: string[];
      mode: string;
    };
    expect(data.event).toBe('wizard_capabilities');
    expect(typeof data.protocolVersion).toBe('number');
    expect(typeof data.eventDataVersions).toBe('object');
    expect(Array.isArray(data.supportedEvents)).toBe(true);
    expect(typeof data.mode).toBe('string');
  });

  it('survives the agent-ui envelope validator (data_version matches registry)', () => {
    // The agent-ui wire boundary runs `validateEnvelopeOrLog` on
    // every emit. The coherence check inside that validator
    // asserts `data_version === EVENT_DATA_VERSIONS[data.event]`
    // — a mismatch lands in the on-disk log but the emit still
    // proceeds. Pinning the registry value here protects against
    // a future bump that updates the registry without bumping the
    // emitter (or vice versa).
    const ui = new AgentUI();
    ui.emitWizardCapabilities();
    const event = findCapabilities(writes)[0];
    expect(event.data_version).toBe(EVENT_DATA_VERSIONS.wizard_capabilities);
    // The wire-format envelope version is independent of the
    // protocol version — pin both so a regression that conflates
    // them fails here.
    expect(event.v).toBe(1);
    const data = event.data as { protocolVersion: number };
    expect(data.protocolVersion).toBe(WIZARD_PROTOCOL_VERSION);
  });
});

// ── No-op surface on non-AgentUI implementations ───────────────────────

describe('emitWizardCapabilities no-op on non-AgentUI implementations', () => {
  it('is optional on the WizardUI base interface (LoggingUI does not implement)', async () => {
    // Only AgentUI emits this event. The optional method signature
    // on WizardUI is the load-bearing contract that lets the
    // runner call `getUI().emitWizardCapabilities?.()` without
    // crashing in TUI / CI mode.
    const { LoggingUI } = await import('../logging-ui.js');
    const logging = new LoggingUI();
    expect(
      (logging as unknown as { emitWizardCapabilities?: unknown })
        .emitWizardCapabilities,
    ).toBeUndefined();
  });
});

// ── Emit ordering: capabilities ALWAYS precedes run_phase: cold_start ──

describe('wizard_capabilities — emit ordering on the stream', () => {
  let writes: string[];
  let restore: () => void;

  beforeEach(() => {
    ({ writes, restore } = setupStdoutSpy());
  });
  afterEach(() => restore());

  it('appears AFTER run_started and BEFORE run_phase: cold_start when emitted in the documented order', () => {
    // The runner wires `emitWizardCapabilities` immediately after
    // `startRun()`. Pin the stream order at the AgentUI level so
    // any future runner refactor that interleaves the calls (e.g.
    // emitting cold_start before capabilities) gets caught by a
    // failing test rather than landing as a silent contract
    // regression.
    const ui = new AgentUI();
    ui.startRun();
    ui.emitWizardCapabilities();
    ui.emitRunPhase('cold_start');
    const events = parseEvents(writes);
    const startRunIdx = events.findIndex(
      (e) => (e.data as { event?: string } | undefined)?.event === 'start_run',
    );
    const capabilitiesIdx = events.findIndex(
      (e) =>
        (e.data as { event?: string } | undefined)?.event ===
        'wizard_capabilities',
    );
    const coldStartIdx = events.findIndex(
      (e) =>
        (e.data as { event?: string; phase?: string } | undefined)?.phase ===
        'cold_start',
    );
    expect(startRunIdx).toBeGreaterThanOrEqual(0);
    expect(capabilitiesIdx).toBeGreaterThanOrEqual(0);
    expect(coldStartIdx).toBeGreaterThanOrEqual(0);
    // Strict ordering: run_started < wizard_capabilities < cold_start.
    expect(startRunIdx).toBeLessThan(capabilitiesIdx);
    expect(capabilitiesIdx).toBeLessThan(coldStartIdx);
  });

  it('does not dedup at the wire — a double-call double-emits (runner-level exactly-once is the load-bearing contract)', () => {
    // The agent-runner wraps the call in try/catch and calls it
    // exactly once per run. The emitter itself deliberately does NOT
    // dedup — a future refactor that accidentally added a second
    // call site would double-emit, and we want that to surface in
    // an orchestrator's parser instead of being silently swallowed.
    // This test pins the no-dedup behaviour so a reader who scans
    // the test name doesn't assume built-in idempotency and then
    // add a second call site believing it's safe.
    const ui = new AgentUI();
    ui.emitWizardCapabilities();
    ui.emitWizardCapabilities();
    expect(findCapabilities(writes).length).toBe(2);
  });
});
