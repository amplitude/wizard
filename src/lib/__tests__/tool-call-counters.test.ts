/**
 * PR 2 — ToolCallCounters aggregates per-hook events into a single
 * `wizard cli: tool summary` analytics payload.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { wizardCaptureSpy } = vi.hoisted(() => ({
  wizardCaptureSpy: vi.fn(),
}));

vi.mock('../../utils/analytics', () => ({
  analytics: { wizardCapture: wizardCaptureSpy },
}));

import { ToolCallCounters } from '../tool-call-counters';

describe('ToolCallCounters', () => {
  beforeEach(() => {
    wizardCaptureSpy.mockReset();
  });

  it('builds a correct snapshot from recorded events', () => {
    const counters = new ToolCallCounters();
    counters.recordToolCall('Read', true);
    counters.recordToolCall('Read', true);
    counters.recordToolCall('Edit', true);
    counters.recordToolCall('Bash', false);
    counters.recordPermissionRequest();
    counters.recordPermissionRequest();
    counters.recordSubagentStart();
    counters.recordCompaction();
    counters.recordCompaction();
    counters.recordCompaction();

    const snap = counters.snapshot();
    expect(snap.toolCallsTotal).toBe(4);
    expect(snap.failuresTotal).toBe(1);
    expect(snap.topTools[0]).toEqual({ name: 'Read', count: 2 });
    expect(snap.permissionRequests).toBe(2);
    expect(snap.subagentSpawns).toBe(1);
    expect(snap.compactions).toBe(3);
  });

  it('caps top tools at 5 entries, sorted descending', () => {
    const counters = new ToolCallCounters();
    const seed: Array<[string, number]> = [
      ['A', 1],
      ['B', 2],
      ['C', 3],
      ['D', 4],
      ['E', 5],
      ['F', 6],
      ['G', 7],
    ];
    for (const [name, n] of seed) {
      for (let i = 0; i < n; i++) counters.recordToolCall(name, true);
    }
    const snap = counters.snapshot();
    expect(snap.topTools).toHaveLength(5);
    expect(snap.topTools.map((t) => t.name)).toEqual(['G', 'F', 'E', 'D', 'C']);
  });

  it('emits `tool summary` event with the aggregated payload', () => {
    const counters = new ToolCallCounters();
    counters.recordToolCall('Read', true);
    counters.recordToolCall('Bash', false);
    counters.recordPermissionRequest();
    counters.recordSubagentStart();
    counters.recordCompaction();

    counters.emit();

    expect(wizardCaptureSpy).toHaveBeenCalledTimes(1);
    const [eventName, props] = wizardCaptureSpy.mock.calls[0];
    expect(eventName).toBe('tool summary');
    expect(props).toMatchObject({
      'tool calls total': 2,
      'failures total': 1,
      'permission requests': 1,
      'subagent spawns': 1,
      compactions: 1,
    });
    expect(props['top tools']).toHaveLength(2);
  });

  it('emits exactly once even when called repeatedly', () => {
    const counters = new ToolCallCounters();
    counters.recordToolCall('Read', true);
    counters.emit();
    counters.emit();
    counters.emit();
    expect(wizardCaptureSpy).toHaveBeenCalledTimes(1);
  });

  it('treats missing tool names as "unknown"', () => {
    const counters = new ToolCallCounters();
    counters.recordToolCall('', true);
    counters.recordToolCall('', false);
    const snap = counters.snapshot();
    expect(snap.topTools[0]).toEqual({ name: 'unknown', count: 2 });
    expect(snap.failuresTotal).toBe(1);
  });
});
