/**
 * Tests for PhaseSnapshotPlugin base class.
 *
 * The base owns phase-transition + finalize boilerplate shared across all
 * benchmark trackers. These tests pin the lifecycle contract that 5 concrete
 * plugins depend on:
 *
 *   - phase transitions push a snapshot for the *outgoing* phase
 *   - `resetPhaseState` runs after the snapshot is captured
 *   - `onPhaseTransitionExtra` runs after reset, before publish
 *   - finalize pushes one last snapshot for the current phase
 *   - `getFinalizePhase` can override the finalize phase identity
 *   - `onFinalizeExtra` runs after publish so subclass side effects see the
 *     final snapshot in the store
 */

import { describe, it, expect } from 'vitest';
import { PhaseSnapshotPlugin } from '../base';
import type {
  MiddlewareContext,
  MiddlewareStore,
  SDKMessage,
} from '../../types';

function makeCtx(overrides?: Partial<MiddlewareContext>): MiddlewareContext {
  return {
    currentPhase: 'setup',
    currentPhaseFreshContext: true,
    get<T>(): T | undefined {
      return undefined;
    },
    ...overrides,
  };
}

function makeStore(): MiddlewareStore & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    set(key, value) {
      data[key] = value;
    },
  };
}

type Snap = { phase: string; counter: number };
type Data = { totalCounter: number; phaseSnapshots: Snap[] };

class Counter extends PhaseSnapshotPlugin<Snap, Data> {
  readonly name = 'counter';
  public phaseCounter = 0;
  public totalCounter = 0;
  public transitionCalls: Array<[string, string]> = [];
  public finalizeCalls = 0;

  bump(): void {
    this.phaseCounter += 1;
    this.totalCounter += 1;
  }

  protected buildPhaseSnapshot(phase: string): Snap {
    return { phase, counter: this.phaseCounter };
  }

  protected resetPhaseState(): void {
    this.phaseCounter = 0;
  }

  protected buildData(): Data {
    return {
      totalCounter: this.totalCounter,
      phaseSnapshots: [...this.phaseSnapshots],
    };
  }

  protected onPhaseTransitionExtra(from: string, to: string): void {
    this.transitionCalls.push([from, to]);
  }

  protected onFinalizeExtra(): void {
    this.finalizeCalls += 1;
  }
}

describe('PhaseSnapshotPlugin', () => {
  it('pushes outgoing phase snapshot and resets state on transition', () => {
    const plugin = new Counter();
    const ctx = makeCtx();
    const store = makeStore();

    plugin.bump();
    plugin.bump();
    plugin.onPhaseTransition('setup', 'instrument', ctx, store);

    const data = store.data.counter as Data;
    expect(data.phaseSnapshots).toEqual([{ phase: 'setup', counter: 2 }]);
    expect(data.totalCounter).toBe(2);
    expect(plugin.phaseCounter).toBe(0); // reset
    expect(plugin.transitionCalls).toEqual([['setup', 'instrument']]);
  });

  it('publishes a final snapshot for currentPhase on finalize', () => {
    const plugin = new Counter();
    const ctx = makeCtx();
    const store = makeStore();

    plugin.bump();
    plugin.onPhaseTransition('setup', 'instrument', ctx, store);
    plugin.bump();
    plugin.bump();
    plugin.bump();
    plugin.onFinalize({ type: 'result' } as SDKMessage, 0, ctx, store);

    const data = store.data.counter as Data;
    expect(data.phaseSnapshots).toEqual([
      { phase: 'setup', counter: 1 },
      { phase: 'instrument', counter: 3 },
    ]);
    expect(plugin.finalizeCalls).toBe(1);
  });

  it('uses getFinalizePhase override for the final snapshot identity', () => {
    class CtxPhaseCounter extends Counter {
      protected getFinalizePhase(ctx: MiddlewareContext): string {
        return ctx.currentPhase;
      }
    }
    const plugin = new CtxPhaseCounter();
    const ctx = makeCtx({ currentPhase: 'wrap-up' });
    const store = makeStore();

    plugin.bump();
    plugin.onFinalize({ type: 'result' } as SDKMessage, 0, ctx, store);

    const data = store.data.counter as Data;
    expect(data.phaseSnapshots).toEqual([{ phase: 'wrap-up', counter: 1 }]);
  });

  it('publish() writes buildData() under the plugin name', () => {
    class Probe extends Counter {
      tick(store: MiddlewareStore): void {
        this.bump();
        this.publish(store);
      }
    }
    const plugin = new Probe();
    const store = makeStore();

    plugin.tick(store);
    plugin.tick(store);

    const data = store.data.counter as Data;
    expect(data.totalCounter).toBe(2);
    expect(data.phaseSnapshots).toEqual([]);
  });
});
