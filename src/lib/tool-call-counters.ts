/**
 * In-process aggregation of per-hook tool-call data for Bet 1 (observability
 * spine), PR 2.
 *
 * Individual tool calls are too high-volume to emit as Amplitude events. We
 * count them here, then emit a single `wizard cli: tool summary` event from
 * the Stop hook with the aggregated totals.
 */

import { analytics } from '../utils/analytics';

export interface ToolSummarySnapshot {
  toolCallsTotal: number;
  failuresTotal: number;
  topTools: Array<{ name: string; count: number }>;
  compactions: number;
  permissionRequests: number;
  subagentSpawns: number;
}

export class ToolCallCounters {
  private toolCallCounts = new Map<string, number>();
  private failuresTotal = 0;
  private permissionRequests = 0;
  private subagentSpawns = 0;
  private compactions = 0;
  private emitted = false;

  recordToolCall(toolName: string, success: boolean): void {
    const key = toolName || 'unknown';
    this.toolCallCounts.set(key, (this.toolCallCounts.get(key) ?? 0) + 1);
    if (!success) this.failuresTotal += 1;
  }

  recordPermissionRequest(): void {
    this.permissionRequests += 1;
  }

  recordSubagentStart(): void {
    this.subagentSpawns += 1;
  }

  recordCompaction(): void {
    this.compactions += 1;
  }

  snapshot(): ToolSummarySnapshot {
    let toolCallsTotal = 0;
    const entries: Array<{ name: string; count: number }> = [];
    for (const [name, count] of this.toolCallCounts) {
      toolCallsTotal += count;
      entries.push({ name, count });
    }
    entries.sort((a, b) => b.count - a.count);
    return {
      toolCallsTotal,
      failuresTotal: this.failuresTotal,
      topTools: entries.slice(0, 5),
      compactions: this.compactions,
      permissionRequests: this.permissionRequests,
      subagentSpawns: this.subagentSpawns,
    };
  }

  /**
   * Emit the `wizard cli: tool summary` event exactly once per counter
   * instance. Safe to call multiple times — subsequent calls no-op so a
   * double-invoked Stop hook doesn't double-count.
   */
  emit(): void {
    if (this.emitted) return;
    this.emitted = true;
    const s = this.snapshot();
    analytics.wizardCapture('tool summary', {
      'tool calls total': s.toolCallsTotal,
      'failures total': s.failuresTotal,
      'top tools': s.topTools,
      compactions: s.compactions,
      'permission requests': s.permissionRequests,
      'subagent spawns': s.subagentSpawns,
    });
  }
}
