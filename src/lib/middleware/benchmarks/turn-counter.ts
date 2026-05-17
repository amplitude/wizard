/**
 * Turn counting plugin with message deduplication.
 *
 * The SDK emits multiple assistant events per turn (one per content block)
 * with the same message ID. This plugin deduplicates and publishes turn
 * counts + a duplicate flag for downstream plugins.
 */

import type { MiddlewareContext, MiddlewareStore, SDKMessage } from '../types';
import { PhaseSnapshotPlugin } from './base';

export interface TurnData {
  /** Whether the current message is a duplicate of the last processed turn */
  isDuplicate: boolean;
  /** Turns in the current phase */
  phaseTurns: number;
  /** Total turns across all phases */
  totalTurns: number;
  /** Per-phase turn snapshots: [{ phase, turns }] */
  phaseSnapshots: Array<{ phase: string; turns: number }>;
}

type TurnSnapshot = { phase: string; turns: number };

export class TurnCounterPlugin extends PhaseSnapshotPlugin<
  TurnSnapshot,
  TurnData
> {
  readonly name = 'turns';

  private lastMessageId: string | null = null;
  private phaseTurns = 0;
  private totalTurns = 0;
  private isDuplicate = false;

  onMessage(
    message: SDKMessage,
    _ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void {
    if (message.type !== 'assistant') {
      this.isDuplicate = false;
      this.publish(store);
      return;
    }

    const msgId: string | undefined = message.message?.id;
    this.isDuplicate = msgId != null && msgId === this.lastMessageId;
    if (msgId) this.lastMessageId = msgId;

    if (!this.isDuplicate) {
      this.phaseTurns++;
      this.totalTurns++;
    }

    this.publish(store);
  }

  protected buildPhaseSnapshot(phase: string): TurnSnapshot {
    return { phase, turns: this.phaseTurns };
  }

  protected resetPhaseState(): void {
    this.phaseTurns = 0;
    this.lastMessageId = null;
  }

  protected buildData(): TurnData {
    return {
      isDuplicate: this.isDuplicate,
      phaseTurns: this.phaseTurns,
      totalTurns: this.totalTurns,
      phaseSnapshots: [...this.phaseSnapshots],
    };
  }
}
