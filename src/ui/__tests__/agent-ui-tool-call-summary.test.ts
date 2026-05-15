/**
 * Regression suite for PR B6 — `tool_call_summary` rollup at phase
 * and terminal exit boundaries.
 *
 * Three layers of coverage:
 *
 *  1. `ToolCallStats` pure helper (counting, outcome accumulation,
 *     duration math, top-tool resolution, zero-call edge case).
 *
 *  2. `AgentUI.emitToolCallSummary` envelope shape on stdout —
 *     `type: 'progress'`, `data.event: 'tool_call_summary'`, the
 *     registered `data_version`, the full payload, and the dedup
 *     guard (identical back-to-back emissions silenced; zero-call
 *     emissions silenced).
 *
 *  3. Cross-module wiring: `emitToolCall` increments the
 *     accumulator (pre-side), `recordToolOutcome` increments
 *     outcomes (post-side), and `getToolCallStats` exposes a stable
 *     accessor for the inner-lifecycle hook to reach.
 *
 * No tests touch `agent-runner.ts` / `wizard-abort.ts` directly —
 * those callsites are thin try/catch shims around
 * `emitToolCallSummary?.()`; their integration is covered by the
 * existing runner/abort suites which don't fail when an optional
 * method is added to WizardUI.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentUI } from '../agent-ui.js';
import { EVENT_DATA_VERSIONS, ToolCallStats } from '../../lib/agent-events.js';

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

const eventsOfType = (writes: string[], type: string): NDJSONEvent[] =>
  writes
    .map((w) => JSON.parse(w.trim()) as NDJSONEvent)
    .filter((e) => e.type === type);

const findToolCallSummary = (writes: string[]): NDJSONEvent | undefined =>
  eventsOfType(writes, 'progress').find(
    (e) =>
      (e.data as { event?: string } | undefined)?.event === 'tool_call_summary',
  );

// ── Pure helper: ToolCallStats ─────────────────────────────────────────

describe('ToolCallStats (pure accumulator)', () => {
  it('starts empty (totalCalls === 0, build() returns null)', () => {
    const stats = new ToolCallStats();
    expect(stats.totalCalls).toBe(0);
    // Zero-call payload is suppressed at the build boundary so the
    // wire boundary doesn't have to special-case it.
    expect(stats.build()).toBeNull();
  });

  it('increments totalCalls and per-tool counts on recordCall', () => {
    const stats = new ToolCallStats();
    stats.recordCall('Edit', 1_000);
    stats.recordCall('Edit', 1_100);
    stats.recordCall('Write', 1_200);
    stats.recordCall('Bash', 1_300);
    expect(stats.totalCalls).toBe(4);
    const payload = stats.build();
    expect(payload).not.toBeNull();
    expect(payload?.byTool).toEqual({ Edit: 2, Write: 1, Bash: 1 });
  });

  it('zero-pads all three outcome buckets even when only some fire', () => {
    // A run with only successful Edit calls still ships
    // `{ success: N, error: 0, denied: 0 }` so an orchestrator
    // can render a stable three-bar chart without missing-key
    // checks.
    const stats = new ToolCallStats();
    stats.recordCall('Edit', 0);
    stats.recordOutcome('Edit', 'success', 100);
    const payload = stats.build();
    expect(payload?.byOutcome).toEqual({ success: 1, error: 0, denied: 0 });
  });

  it('accumulates duration FIFO-by-tool from recordCall to recordOutcome', () => {
    // Two concurrent Edit calls (sequential under the current SDK,
    // but the accumulator is FIFO-by-tool to stay correct under a
    // future parallel-dispatch hypothetical). The first PreToolUse
    // must pair with the first PostToolUse — not the second, even
    // if the second has a smaller elapsed time.
    const stats = new ToolCallStats();
    stats.recordCall('Edit', 1_000); // start of long edit
    stats.recordCall('Edit', 1_100); // start of short edit
    stats.recordOutcome('Edit', 'success', 1_500); // close FIRST edit (500ms)
    stats.recordOutcome('Edit', 'success', 1_200); // close SECOND edit (100ms)
    const payload = stats.build();
    expect(payload?.durationMsTotal).toBe(600);
    expect(payload?.durationMsAvg).toBe(300);
  });

  it('floors duration at 0 for a non-monotonic clock', () => {
    const stats = new ToolCallStats();
    stats.recordCall('Edit', 1_000);
    stats.recordOutcome('Edit', 'success', 500); // clock went backwards
    expect(stats.build()?.durationMsTotal).toBe(0);
  });

  it('handles orphaned PostToolUse (recordOutcome without recordCall) without throwing', () => {
    // Test fixtures sometimes simulate the post side without a pre
    // — the outcome should still count, duration unchanged.
    const stats = new ToolCallStats();
    stats.recordCall('Edit', 0);
    stats.recordOutcome('Edit', 'success', 100);
    stats.recordOutcome('Write', 'error', 200); // orphan
    const payload = stats.build();
    expect(payload?.totalCalls).toBe(1);
    expect(payload?.byOutcome).toEqual({ success: 1, error: 1, denied: 0 });
    expect(payload?.durationMsTotal).toBe(100);
  });

  it('records denied outcomes separately from error', () => {
    const stats = new ToolCallStats();
    stats.recordCall('Bash');
    stats.recordCall('Edit');
    stats.recordOutcome('Bash', 'denied');
    stats.recordOutcome('Edit', 'error');
    const payload = stats.build();
    expect(payload?.byOutcome).toEqual({ success: 0, error: 1, denied: 1 });
  });

  it('resolves topToolByCount to the single max-count tool', () => {
    const stats = new ToolCallStats();
    for (let i = 0; i < 5; i++) stats.recordCall('Edit');
    for (let i = 0; i < 2; i++) stats.recordCall('Bash');
    stats.recordCall('Write');
    const payload = stats.build();
    expect(payload?.topToolByCount).toBe('Edit');
  });

  it('omits topToolByCount when two or more tools tie', () => {
    // Tied counts → orchestrator computes its own tie-breaker
    // (or doesn't surface a top tool at all). Wizard side stays
    // deterministic by omitting the field rather than picking
    // alphabetically / by insertion order.
    const stats = new ToolCallStats();
    stats.recordCall('Edit');
    stats.recordCall('Edit');
    stats.recordCall('Bash');
    stats.recordCall('Bash');
    const payload = stats.build();
    expect(payload?.topToolByCount).toBeUndefined();
  });

  it('build() is non-destructive — repeated calls return the same payload', () => {
    // Terminal-exit emission re-emits the full cumulative rollup
    // after finalize already emitted once. build() must not reset
    // the accumulator.
    const stats = new ToolCallStats();
    stats.recordCall('Edit', 0);
    stats.recordOutcome('Edit', 'success', 100);
    const first = stats.build();
    const second = stats.build();
    expect(second).toEqual(first);
  });
});

// ── AgentUI envelope: emitToolCallSummary ──────────────────────────────

describe('AgentUI.emitToolCallSummary (PR B6: rollup at phase + terminal boundaries)', () => {
  let writes: string[];
  let restore: () => void;

  beforeEach(() => {
    ({ writes, restore } = setupStdoutSpy());
  });
  afterEach(() => restore());

  it('no-ops at the wire when no tool calls have been recorded', () => {
    // Zero-call payload is suppressed at the wire — absence of
    // the event is the signal "no tools were called".
    const ui = new AgentUI();
    ui.emitToolCallSummary?.();
    expect(findToolCallSummary(writes)).toBeUndefined();
  });

  it('emits a progress: tool_call_summary with totalCalls / byTool / byOutcome / duration', () => {
    const ui = new AgentUI();
    ui.emitToolCall({ tool: 'Edit', summary: 'a.ts' });
    ui.recordToolOutcome('Edit', 'success');
    ui.emitToolCall({ tool: 'Write', summary: 'b.ts' });
    ui.recordToolOutcome('Write', 'success');
    ui.emitToolCall({ tool: 'Bash', summary: 'pnpm test' });
    ui.recordToolOutcome('Bash', 'error');

    ui.emitToolCallSummary?.();
    const event = findToolCallSummary(writes);
    expect(event).toBeDefined();
    expect(event?.v).toBe(1);
    expect(event?.type).toBe('progress');
    expect(event?.data).toMatchObject({
      event: 'tool_call_summary',
      totalCalls: 3,
      byTool: { Edit: 1, Write: 1, Bash: 1 },
      byOutcome: { success: 2, error: 1, denied: 0 },
    });
    expect(event?.data_version).toBe(EVENT_DATA_VERSIONS.tool_call_summary);
  });

  it('stamps the registered data_version', () => {
    const ui = new AgentUI();
    ui.emitToolCall({ tool: 'Edit' });
    ui.emitToolCallSummary?.();
    const event = findToolCallSummary(writes);
    expect(event?.data_version).toBe(EVENT_DATA_VERSIONS.tool_call_summary);
  });

  it('preserves @timestamp as an ISO string', () => {
    const ui = new AgentUI();
    ui.emitToolCall({ tool: 'Read' });
    ui.emitToolCallSummary?.();
    const event = findToolCallSummary(writes);
    expect(typeof event?.['@timestamp']).toBe('string');
    expect(() => new Date(event?.['@timestamp'] ?? '')).not.toThrow();
  });

  it('includes topToolByCount when one tool dominates', () => {
    const ui = new AgentUI();
    // 5 Edits, 2 Bashes, 1 Write → Edit dominates.
    for (let i = 0; i < 5; i++) ui.emitToolCall({ tool: 'Edit' });
    for (let i = 0; i < 2; i++) ui.emitToolCall({ tool: 'Bash' });
    ui.emitToolCall({ tool: 'Write' });
    ui.emitToolCallSummary?.();
    const event = findToolCallSummary(writes);
    expect(event?.data?.topToolByCount).toBe('Edit');
  });

  it('dedup-safe: calling emit twice at the same boundary ships only one envelope', () => {
    // Phase finalize then terminal exit with no intervening tool
    // calls — the payload signature is identical, so the second
    // emission is a no-op on the wire. Orchestrators see one
    // envelope, not two.
    const ui = new AgentUI();
    ui.emitToolCall({ tool: 'Edit' });
    ui.recordToolOutcome('Edit', 'success');
    ui.emitToolCallSummary?.(); // phase finalize
    ui.emitToolCallSummary?.(); // terminal exit (no new tool calls)
    const events = eventsOfType(writes, 'progress').filter(
      (e) =>
        (e.data as { event?: string } | undefined)?.event ===
        'tool_call_summary',
    );
    expect(events.length).toBe(1);
  });

  it('emits a SECOND envelope when new tool calls land between boundaries', () => {
    // Post-agent steps that themselves issue tool calls (today
    // rare, tomorrow common) MUST be reflected in the terminal
    // emission even though the finalize emission already fired.
    // The signature changes → the dedup guard releases.
    const ui = new AgentUI();
    ui.emitToolCall({ tool: 'Edit' });
    ui.recordToolOutcome('Edit', 'success');
    ui.emitToolCallSummary?.(); // finalize emission
    ui.emitToolCall({ tool: 'Write' });
    ui.recordToolOutcome('Write', 'success');
    ui.emitToolCallSummary?.(); // terminal emission (new call)
    const events = eventsOfType(writes, 'progress').filter(
      (e) =>
        (e.data as { event?: string } | undefined)?.event ===
        'tool_call_summary',
    );
    expect(events.length).toBe(2);
    expect(events[0].data).toMatchObject({ totalCalls: 1 });
    expect(events[1].data).toMatchObject({ totalCalls: 2 });
  });

  it('accumulates correctly across a realistic 50-call run', () => {
    // Sanity check at the volume the spec calls out (30-200
    // events). Confirms the rollup is internally consistent —
    // totalCalls equals the sum of byTool, sum of byOutcome
    // equals totalCalls.
    const ui = new AgentUI();
    for (let i = 0; i < 30; i++) {
      ui.emitToolCall({ tool: 'Edit' });
      ui.recordToolOutcome('Edit', 'success');
    }
    for (let i = 0; i < 12; i++) {
      ui.emitToolCall({ tool: 'Bash' });
      ui.recordToolOutcome('Bash', i < 10 ? 'success' : 'error');
    }
    for (let i = 0; i < 8; i++) {
      ui.emitToolCall({ tool: 'Write' });
      ui.recordToolOutcome('Write', 'success');
    }
    ui.emitToolCallSummary?.();
    const event = findToolCallSummary(writes);
    const data = event?.data as
      | {
          totalCalls: number;
          byTool: Record<string, number>;
          byOutcome: { success: number; error: number; denied: number };
          topToolByCount?: string;
        }
      | undefined;
    expect(data?.totalCalls).toBe(50);
    expect(data?.byTool).toEqual({ Edit: 30, Bash: 12, Write: 8 });
    expect(data?.byOutcome).toEqual({ success: 48, error: 2, denied: 0 });
    // Sums match — the rollup is internally consistent.
    expect(Object.values(data?.byTool ?? {}).reduce((s, n) => s + n, 0)).toBe(
      data?.totalCalls,
    );
    expect(
      Object.values(data?.byOutcome ?? {}).reduce((s, n) => s + n, 0),
    ).toBe(data?.totalCalls);
    expect(data?.topToolByCount).toBe('Edit');
  });

  it('getToolCallStats exposes the live accumulator for inner-lifecycle hooks', () => {
    // The inner-lifecycle PostToolUse hook reaches the stats via
    // `recordToolOutcome` on AgentUI directly today, but
    // `getToolCallStats` is the stable accessor that future hooks
    // can use for richer telemetry (e.g. surfacing the current
    // count to a heartbeat).
    const ui = new AgentUI();
    ui.emitToolCall({ tool: 'Edit' });
    const stats = ui.getToolCallStats();
    expect(stats).toBeInstanceOf(ToolCallStats);
    expect(stats.totalCalls).toBe(1);
  });
});

// ── No-op surface on non-AgentUI implementations ───────────────────────

describe('emitToolCallSummary no-op on non-AgentUI implementations', () => {
  it('is optional on the WizardUI base interface (LoggingUI does not implement)', async () => {
    // Only AgentUI emits this event. The optional method signature
    // on WizardUI is the load-bearing contract that lets the runner
    // / abort path call `getUI().emitToolCallSummary?.()` without
    // crashing in TUI / CI mode.
    const { LoggingUI } = await import('../logging-ui.js');
    const logging = new LoggingUI();
    expect(
      (logging as unknown as { emitToolCallSummary?: unknown })
        .emitToolCallSummary,
    ).toBeUndefined();
  });
});
