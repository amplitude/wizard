/**
 * Compaction event tracking plugin.
 *
 * Tracks context compaction events (compact_boundary system messages)
 * including pre-compaction token counts per phase.
 */

import type { MiddlewareContext, MiddlewareStore, SDKMessage } from '../types';
import { logToFile } from '../../../utils/debug';
import { AgentSignals } from '../../agent-interface';
import { PhaseSnapshotPlugin } from './base';

export interface CompactionData {
  phaseCompactions: number;
  phasePreTokens: number[];
  totalCompactions: number;
  phaseSnapshots: Array<{
    phase: string;
    compactions: number;
    preTokens: number[];
  }>;
}

type CompactionSnapshot = {
  phase: string;
  compactions: number;
  preTokens: number[];
};

export class CompactionTrackerPlugin extends PhaseSnapshotPlugin<
  CompactionSnapshot,
  CompactionData
> {
  readonly name = 'compactions';

  private phaseCompactions = 0;
  private phasePreTokens: number[] = [];
  private totalCompactions = 0;

  onMessage(
    message: SDKMessage,
    ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void {
    if (message.type !== 'system' || message.subtype !== 'compact_boundary') {
      return;
    }

    const preTokens = message.compact_metadata?.pre_tokens ?? 0;
    const trigger = message.compact_metadata?.trigger ?? 'unknown';
    this.phaseCompactions++;
    this.totalCompactions++;
    this.phasePreTokens.push(preTokens);

    logToFile(
      `${AgentSignals.BENCHMARK} [COMPACTION] Context compacted during "${ctx.currentPhase}" (trigger: ${trigger}, pre_tokens: ${preTokens})`,
    );

    this.publish(store);
  }

  protected buildPhaseSnapshot(phase: string): CompactionSnapshot {
    return {
      phase,
      compactions: this.phaseCompactions,
      preTokens: [...this.phasePreTokens],
    };
  }

  protected resetPhaseState(): void {
    this.phaseCompactions = 0;
    this.phasePreTokens = [];
  }

  protected buildData(): CompactionData {
    return {
      phaseCompactions: this.phaseCompactions,
      phasePreTokens: [...this.phasePreTokens],
      totalCompactions: this.totalCompactions,
      phaseSnapshots: [...this.phaseSnapshots],
    };
  }
}
