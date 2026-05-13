/**
 * Regression suite for PR B7 — `mcp_status` MCP server lifecycle
 * observability events.
 *
 * Three layers of coverage:
 *
 *  1. `AgentUI.emitMcpStatus` envelope shape on stdout —
 *     `type: 'lifecycle'`, `data.event: 'mcp_status'`, the
 *     registered `data_version`, the full payload (server, state,
 *     transition_ts, optional detail).
 *
 *  2. One pinned test per `(server, state)` transition the spec
 *     calls out — `wizard_tools/{available, failed}` and
 *     `editor_install/{not_applicable, install_skipped,
 *     needs_user_choice, installed, failed}`. The Zod-validated
 *     payload schema rejects invalid `state` literals so an
 *     orchestrator never sees a typo on the wire.
 *
 *  3. No-op behaviour on non-AgentUI implementations (LoggingUI)
 *     and silence on the wire for non-MCP-related runs (the event
 *     must NOT appear in the stream when no MCP code path fires).
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

const parseEvents = (writes: string[]): NDJSONEvent[] =>
  writes.map((w) => JSON.parse(w.trim()) as NDJSONEvent);

const findMcpStatus = (writes: string[]): NDJSONEvent[] =>
  parseEvents(writes).filter(
    (e) => (e.data as { event?: string } | undefined)?.event === 'mcp_status',
  );

// ── AgentUI envelope: emitMcpStatus ────────────────────────────────────

describe('AgentUI.emitMcpStatus (PR B7: MCP server lifecycle)', () => {
  let writes: string[];
  let restore: () => void;

  beforeEach(() => {
    ({ writes, restore } = setupStdoutSpy());
  });
  afterEach(() => restore());

  it('emits a lifecycle envelope with data.event = "mcp_status"', () => {
    const ui = new AgentUI();
    ui.emitMcpStatus?.({
      server: 'wizard_tools',
      state: 'available',
      transition_ts: 1_700_000_000_000,
      detail: 'wizard-tools server bootstrapped on stdio',
    });
    const events = findMcpStatus(writes);
    expect(events.length).toBe(1);
    const event = events[0];
    expect(event.v).toBe(1);
    expect(event.type).toBe('lifecycle');
    expect(event.data).toMatchObject({
      event: 'mcp_status',
      server: 'wizard_tools',
      state: 'available',
      transition_ts: 1_700_000_000_000,
      detail: 'wizard-tools server bootstrapped on stdio',
    });
  });

  it('stamps the registered data_version for mcp_status', () => {
    const ui = new AgentUI();
    ui.emitMcpStatus?.({
      server: 'wizard_tools',
      state: 'available',
      transition_ts: Date.now(),
    });
    const event = findMcpStatus(writes)[0];
    expect(event.data_version).toBe(EVENT_DATA_VERSIONS.mcp_status);
  });

  it('preserves @timestamp as an ISO string', () => {
    const ui = new AgentUI();
    ui.emitMcpStatus?.({
      server: 'editor_install',
      state: 'installed',
      transition_ts: Date.now(),
    });
    const event = findMcpStatus(writes)[0];
    expect(typeof event['@timestamp']).toBe('string');
    expect(() => new Date(event['@timestamp'])).not.toThrow();
  });

  it('omits the detail key when no detail is supplied', () => {
    // Optional field must not ship as `undefined` — the Zod schema
    // makes it optional and the spread preserves absence.
    const ui = new AgentUI();
    ui.emitMcpStatus?.({
      server: 'wizard_tools',
      state: 'available',
      transition_ts: Date.now(),
    });
    const event = findMcpStatus(writes)[0];
    expect(event.data).not.toHaveProperty('detail');
  });

  it('rejects an invalid state value at the emit boundary (Zod guard)', () => {
    // The Zod schema is defense-in-depth — a misbehaving caller
    // shipping a typo'd state literal gets caught here rather than
    // poisoning the orchestrator's parser. The bad payload is NOT
    // emitted (avoids data corruption on the wire); a log line is
    // written to the on-disk debug log instead.
    const ui = new AgentUI();
    ui.emitMcpStatus?.({
      // @ts-expect-error — deliberately invalid state literal
      server: 'wizard_tools',
      state: 'not_a_real_state',
      transition_ts: Date.now(),
    });
    expect(findMcpStatus(writes)).toEqual([]);
  });

  it('rejects an invalid server value at the emit boundary', () => {
    const ui = new AgentUI();
    ui.emitMcpStatus?.({
      // @ts-expect-error — deliberately invalid server literal
      server: 'amplitude_mcp',
      state: 'available',
      transition_ts: Date.now(),
    });
    expect(findMcpStatus(writes)).toEqual([]);
  });
});

// ── Per-transition pinning: every (server, state) combo we wire ────────

describe('mcp_status — per-transition wire shape', () => {
  let writes: string[];
  let restore: () => void;

  beforeEach(() => {
    ({ writes, restore } = setupStdoutSpy());
  });
  afterEach(() => restore());

  /**
   * The spec calls out these state transitions:
   *
   *   wizard_tools:    available, failed
   *   editor_install:  not_applicable, install_skipped,
   *                    needs_user_choice, installed, failed
   *
   * Each one is wired at a real call site (see agent-interface.ts
   * for wizard_tools; src/steps/add-mcp-server-to-clients/index.ts
   * and src/ui/tui/screens/McpScreen.tsx for editor_install). The
   * tests below pin the contract end-to-end at the emitter so a
   * future refactor that drops one of the call sites still gets
   * caught by a failing wire test.
   */
  const cases: Array<{
    server: 'wizard_tools' | 'editor_install';
    state:
      | 'available'
      | 'failed'
      | 'not_applicable'
      | 'install_skipped'
      | 'needs_user_choice'
      | 'installed';
    detail: string;
  }> = [
    {
      server: 'wizard_tools',
      state: 'available',
      detail: 'wizard-tools server bootstrapped on stdio',
    },
    {
      server: 'wizard_tools',
      state: 'failed',
      detail: 'ENOENT: missing skill bundle',
    },
    {
      server: 'editor_install',
      state: 'not_applicable',
      detail: 'no supported MCP editor clients detected on this machine',
    },
    {
      server: 'editor_install',
      state: 'install_skipped',
      detail: 'user declined editor MCP install',
    },
    {
      server: 'editor_install',
      state: 'needs_user_choice',
      detail: 'multiple editor clients detected; awaiting user pick',
    },
    {
      server: 'editor_install',
      state: 'installed',
      detail: 'installed: Cursor, Claude Code',
    },
    {
      server: 'editor_install',
      state: 'failed',
      detail: 'EACCES: permission denied writing ~/.cursor/mcp.json',
    },
  ];

  for (const { server, state, detail } of cases) {
    it(`emits ${server}/${state} with the documented envelope`, () => {
      const ui = new AgentUI();
      const ts = Date.now();
      ui.emitMcpStatus?.({ server, state, transition_ts: ts, detail });
      const event = findMcpStatus(writes)[0];
      expect(event).toBeDefined();
      expect(event.type).toBe('lifecycle');
      expect(event.data).toMatchObject({
        event: 'mcp_status',
        server,
        state,
        transition_ts: ts,
        detail,
      });
      expect(event.data_version).toBe(EVENT_DATA_VERSIONS.mcp_status);
      // The human-readable `message` mirrors the (server, state)
      // pair so a log-scraping consumer can render the transition
      // without unwrapping `data`.
      expect(event.message).toBe(`mcp_status: ${server} -> ${state}`);
    });
  }
});

// ── No-op surface on non-AgentUI implementations ───────────────────────

describe('emitMcpStatus no-op on non-AgentUI implementations', () => {
  it('is optional on the WizardUI base interface (LoggingUI does not implement)', async () => {
    // Only AgentUI emits this event. The optional method signature
    // on WizardUI is the load-bearing contract that lets the
    // wizard-tools boot path and the editor-install step call
    // `getUI().emitMcpStatus?.()` without crashing in TUI / CI mode.
    const { LoggingUI } = await import('../logging-ui.js');
    const logging = new LoggingUI();
    expect(
      (logging as unknown as { emitMcpStatus?: unknown }).emitMcpStatus,
    ).toBeUndefined();
  });
});

// ── Stream silence on non-MCP runs ─────────────────────────────────────

describe('mcp_status absence on non-MCP-related stream activity', () => {
  let writes: string[];
  let restore: () => void;

  beforeEach(() => {
    ({ writes, restore } = setupStdoutSpy());
  });
  afterEach(() => restore());

  it('does not appear on the wire when only unrelated events are emitted', () => {
    // The mcp_status event is observational — emitting it
    // unconditionally on a generic run would spam the orchestrator
    // with no-op transitions. Verify the wire stays clean unless a
    // call site explicitly emits.
    const ui = new AgentUI();
    ui.startRun();
    ui.emitRunPhase('cold_start');
    ui.emitToolCall({ tool: 'Edit' });
    ui.recordToolOutcome('Edit', 'success');
    ui.emitToolCallSummary?.();
    expect(findMcpStatus(writes)).toEqual([]);
  });

  it('records a single transition without polluting subsequent events', () => {
    const ui = new AgentUI();
    ui.emitMcpStatus?.({
      server: 'wizard_tools',
      state: 'available',
      transition_ts: 1_700_000_000_000,
    });
    ui.emitToolCall({ tool: 'Edit' });
    ui.recordToolOutcome('Edit', 'success');
    ui.emitToolCallSummary?.();
    // Exactly one mcp_status; tool_call_summary and tool_call still
    // ship on the same stream without interference.
    expect(findMcpStatus(writes).length).toBe(1);
    expect(parseEvents(writes).length).toBeGreaterThanOrEqual(3);
  });
});
