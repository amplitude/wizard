/**
 * Context size tracking plugin (context tokens in/out per phase).
 *
 * Context tokens out = sum of input + cache_read + cache_creation from the
 * last assistant message's usage (per-turn, NOT aggregate).
 * Context tokens in = previous phase's context tokens out.
 */

import type {
  Middleware,
  MiddlewareContext,
  MiddlewareStore,
  SDKMessage,
  SDKUsage,
} from '../types';
import type { TokenData } from './token-tracker';
import { inputTokensWithCache } from './_usage';

export interface ContextSizeData {
  /** Per-phase context size snapshots */
  phaseSnapshots: Array<{
    phase: string;
    contextTokensIn?: number;
    contextTokensOut?: number;
    freshContext: boolean;
  }>;
}

export class ContextSizeTrackerPlugin implements Middleware {
  readonly name = 'contextSize';

  private phaseSnapshots: Array<{
    phase: string;
    contextTokensIn?: number;
    contextTokensOut?: number;
    freshContext: boolean;
  }> = [];
  private lastContextTokensOut?: number;

  onPhaseTransition(
    fromPhase: string,
    _toPhase: string,
    ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void {
    const tokens = ctx.get<TokenData>('tokens');
    const contextTokensOut = this.computeContextTokensOut(tokens?.lastUsage);

    this.phaseSnapshots.push({
      phase: fromPhase,
      contextTokensIn: ctx.currentPhaseFreshContext
        ? undefined
        : this.lastContextTokensOut,
      contextTokensOut,
      freshContext: ctx.currentPhaseFreshContext,
    });

    this.lastContextTokensOut = contextTokensOut;
    store.set('contextSize', this.getData());
  }

  onFinalize(
    _resultMessage: SDKMessage,
    _totalDurationMs: number,
    ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void {
    const tokens = ctx.get<TokenData>('tokens');
    const contextTokensOut = this.computeContextTokensOut(tokens?.lastUsage);

    this.phaseSnapshots.push({
      phase: ctx.currentPhase,
      contextTokensIn: ctx.currentPhaseFreshContext
        ? undefined
        : this.lastContextTokensOut,
      contextTokensOut,
      freshContext: ctx.currentPhaseFreshContext,
    });

    store.set('contextSize', this.getData());
  }

  private computeContextTokensOut(
    usage: SDKUsage | null | undefined,
  ): number | undefined {
    if (!usage) return undefined;
    return inputTokensWithCache(usage);
  }

  private getData(): ContextSizeData {
    return {
      phaseSnapshots: [...this.phaseSnapshots],
    };
  }
}
