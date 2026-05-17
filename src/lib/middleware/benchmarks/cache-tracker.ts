/**
 * Cache token tracking plugin (cache_read and cache_creation).
 *
 * Respects the dedup flag from TurnCounterPlugin.
 */

import type { MiddlewareContext, MiddlewareStore, SDKMessage } from '../types';
import type { TurnData } from './turn-counter';
import { PhaseSnapshotPlugin } from './base';

/** Matches SDK usage.cache_creation (ephemeral 5m vs 1h for pricing). */
export interface CacheCreationBreakdown {
  ephemeral_5m_input_tokens: number;
  ephemeral_1h_input_tokens: number;
}

export interface CacheData {
  phaseRead: number;
  phaseCreation: number;
  totalRead: number;
  totalCreation: number;
  totalCreation5m: number;
  totalCreation1h: number;
  phaseSnapshots: Array<{
    phase: string;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    /** When present, use for pricing (5m vs 1h rates). */
    cacheCreation5m: number;
    cacheCreation1h: number;
  }>;
}

type CacheSnapshot = {
  phase: string;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheCreation5m: number;
  cacheCreation1h: number;
};

export class CacheTrackerPlugin extends PhaseSnapshotPlugin<
  CacheSnapshot,
  CacheData
> {
  readonly name = 'cache';

  private phaseRead = 0;
  private phaseCreation = 0;
  private phaseCreation5m = 0;
  private phaseCreation1h = 0;
  private totalRead = 0;
  private totalCreation = 0;
  private totalCreation5m = 0;
  private totalCreation1h = 0;

  onMessage(
    message: SDKMessage,
    ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void {
    if (message.type !== 'assistant') return;

    const turns = ctx.get<TurnData>('turns');
    if (turns?.isDuplicate) return;

    const usage = message.message?.usage;
    if (usage) {
      const read = Number(usage.cache_read_input_tokens ?? 0);
      const creation = Number(usage.cache_creation_input_tokens ?? 0);
      const cc = usage.cache_creation;
      const creation5m = Number(cc?.ephemeral_5m_input_tokens ?? 0);
      const creation1h = Number(cc?.ephemeral_1h_input_tokens ?? 0);
      this.phaseRead += read;
      this.phaseCreation += creation;
      this.phaseCreation5m += creation5m;
      this.phaseCreation1h += creation1h;
      this.totalRead += read;
      this.totalCreation += creation;
    }

    this.publish(store);
  }

  protected buildPhaseSnapshot(phase: string): CacheSnapshot {
    return {
      phase,
      cacheReadTokens: this.phaseRead,
      cacheCreationTokens: this.phaseCreation,
      cacheCreation5m: this.phaseCreation5m,
      cacheCreation1h: this.phaseCreation1h,
    };
  }

  protected resetPhaseState(): void {
    this.phaseRead = 0;
    this.phaseCreation = 0;
    this.phaseCreation5m = 0;
    this.phaseCreation1h = 0;
  }

  protected buildData(): CacheData {
    return {
      phaseRead: this.phaseRead,
      phaseCreation: this.phaseCreation,
      totalRead: this.totalRead,
      totalCreation: this.totalCreation,
      totalCreation5m: this.totalCreation5m,
      totalCreation1h: this.totalCreation1h,
      phaseSnapshots: [...this.phaseSnapshots],
    };
  }
}
