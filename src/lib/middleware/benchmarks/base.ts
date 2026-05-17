/**
 * PhaseSnapshotPlugin — shared base for benchmark plugins that accumulate
 * per-phase state and emit a final snapshot on phase transition + run finalize.
 *
 * The 5 benchmark trackers (tokens, cache, compactions, turns, contextSize)
 * all follow the same lifecycle:
 *
 *   1. accumulate state per `onMessage` (plugin-specific)
 *   2. on phase transition: push a snapshot for the *outgoing* phase, reset
 *      per-phase counters, publish updated data to the store
 *   3. on finalize: push one last snapshot for the current phase, publish
 *
 * Per-plugin field names diverge (`tokensIn`, `cacheHits`, etc.), so this base
 * is generic in both the snapshot type and the published data type:
 *
 *   PhaseSnapshotPlugin<TSnapshot, TData>
 *
 * Subclasses implement three required hooks (`buildPhaseSnapshot`,
 * `buildData`) plus optional ones (`resetPhaseState`,
 * `onPhaseTransitionExtra`, `onFinalizeExtra`, `getFinalizePhase`) for plugins
 * that need extra behaviour (Sentry measurements, debug logging, fresh-context
 * phase identity, etc.).
 *
 * `onMessage` is intentionally NOT in the base — accumulation patterns differ
 * too much across plugins. Subclasses call `this.publish(store)` after they
 * mutate state. The base only owns phase-transition + finalize boilerplate.
 */

import type {
  Middleware,
  MiddlewareContext,
  MiddlewareStore,
  SDKMessage,
} from '../types';

export abstract class PhaseSnapshotPlugin<TSnapshot, TData>
  implements Middleware
{
  /** Store key — also used as the middleware `name` in the pipeline. */
  abstract readonly name: string;

  /** Current phase identity, advanced on each `onPhaseTransition`. */
  protected currentPhase = 'setup';

  /** Snapshots accumulated across phase transitions and finalize. */
  protected phaseSnapshots: TSnapshot[] = [];

  /**
   * Build a snapshot record for `phase` from current accumulated state.
   * Called both during phase transitions (for the outgoing phase) and at
   * finalize (for the last phase).
   */
  protected abstract buildPhaseSnapshot(
    phase: string,
    ctx: MiddlewareContext,
  ): TSnapshot;

  /**
   * Build the full data payload published to the store.
   * Includes `phaseSnapshots` plus any plugin-specific totals.
   */
  protected abstract buildData(): TData;

  /**
   * Reset per-phase mutable state after a snapshot has been pushed.
   * Default is a no-op — override when the plugin tracks per-phase counters
   * that need clearing between phases (most subclasses do).
   */
  protected resetPhaseState(): void {
    // no-op
  }

  /**
   * Hook for extra work after the phase transition snapshot + reset have run
   * but before the store publish. Use for plugin-specific transition logic
   * (e.g. TurnCounter resetting `lastMessageId`).
   */
  protected onPhaseTransitionExtra?(
    fromPhase: string,
    toPhase: string,
    ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void;

  /**
   * Hook for extra work at finalize after the final snapshot is pushed and
   * data is published. Use for one-shot side effects (Sentry measurements,
   * log lines, etc.). Plugins that need a non-`unknown` return type from
   * `onFinalize` should override `onFinalize` directly.
   */
  protected onFinalizeExtra?(
    resultMessage: SDKMessage,
    totalDurationMs: number,
    ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void;

  /**
   * Determines the phase name used for the *final* snapshot pushed at
   * finalize. Defaults to `this.currentPhase` (the last `toPhase` from a
   * transition). Override to return `ctx.currentPhase` when the plugin
   * should follow the live middleware-context phase instead.
   */
  protected getFinalizePhase(_ctx: MiddlewareContext): string {
    return this.currentPhase;
  }

  /**
   * Publish the current `buildData()` payload to the store. Subclasses call
   * this from their own `onMessage` after mutating per-phase counters.
   */
  protected publish(store: MiddlewareStore): void {
    store.set(this.name, this.buildData());
  }

  onPhaseTransition(
    fromPhase: string,
    toPhase: string,
    ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void {
    this.phaseSnapshots.push(this.buildPhaseSnapshot(fromPhase, ctx));
    this.currentPhase = toPhase;
    this.resetPhaseState();
    this.onPhaseTransitionExtra?.(fromPhase, toPhase, ctx, store);
    this.publish(store);
  }

  onFinalize(
    resultMessage: SDKMessage,
    totalDurationMs: number,
    ctx: MiddlewareContext,
    store: MiddlewareStore,
  ): void {
    this.phaseSnapshots.push(
      this.buildPhaseSnapshot(this.getFinalizePhase(ctx), ctx),
    );
    this.publish(store);
    this.onFinalizeExtra?.(resultMessage, totalDurationMs, ctx, store);
  }
}
