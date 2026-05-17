/**
 * Context size tracking plugin (context tokens in/out per phase).
 *
 * Context tokens out = sum of input + cache_read + cache_creation from the
 * last assistant message's usage (per-turn, NOT aggregate).
 * Context tokens in = previous phase's context tokens out.
 */

import type { MiddlewareContext, SDKUsage } from '../types';
import type { TokenData } from './token-tracker';
import { inputTokensWithCache } from './_usage';
import { PhaseSnapshotPlugin } from './base';

export interface ContextSizeData {
  /** Per-phase context size snapshots */
  phaseSnapshots: Array<{
    phase: string;
    contextTokensIn?: number;
    contextTokensOut?: number;
    freshContext: boolean;
  }>;
}

type ContextSizeSnapshot = {
  phase: string;
  contextTokensIn?: number;
  contextTokensOut?: number;
  freshContext: boolean;
};

export class ContextSizeTrackerPlugin extends PhaseSnapshotPlugin<
  ContextSizeSnapshot,
  ContextSizeData
> {
  readonly name = 'contextSize';

  private lastContextTokensOut?: number;

  protected buildPhaseSnapshot(
    phase: string,
    ctx: MiddlewareContext,
  ): ContextSizeSnapshot {
    const tokens = ctx.get<TokenData>('tokens');
    const contextTokensOut = this.computeContextTokensOut(tokens?.lastUsage);

    const snapshot: ContextSizeSnapshot = {
      phase,
      contextTokensIn: ctx.currentPhaseFreshContext
        ? undefined
        : this.lastContextTokensOut,
      contextTokensOut,
      freshContext: ctx.currentPhaseFreshContext,
    };

    // Roll the "previous out" forward so the next phase's `contextTokensIn`
    // can read it. The base pushes the snapshot before this returns, so
    // updating here matches the original ordering (push, then bump).
    this.lastContextTokensOut = contextTokensOut;

    return snapshot;
  }

  protected buildData(): ContextSizeData {
    return {
      phaseSnapshots: [...this.phaseSnapshots],
    };
  }

  protected getFinalizePhase(ctx: MiddlewareContext): string {
    // Use the live middleware-context phase rather than the last `toPhase`.
    // The original behaviour used `ctx.currentPhase` for the finalize
    // snapshot — preserve it so downstream consumers (json-writer golden
    // snapshot) see the same identity they always have.
    return ctx.currentPhase;
  }

  private computeContextTokensOut(
    usage: SDKUsage | null | undefined,
  ): number | undefined {
    if (!usage) return undefined;
    return inputTokensWithCache(usage);
  }
}
