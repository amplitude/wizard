/**
 * Tests for TokenTrackerPlugin.
 *
 * Two responsibilities under test:
 *   1. Existing benchmark math (input/output accumulation, dedup, phase
 *      snapshots) is unchanged.
 *   2. setSpanMeasurement is called on onFinalize with the right token
 *      counts so Sentry traces gain first-class measurement metrics.
 *
 * The observability module is mocked so no real Sentry calls fire.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { setSpanMeasurement } = vi.hoisted(() => ({
  setSpanMeasurement: vi.fn(),
}));
vi.mock('../../../observability/index', () => ({
  setSpanMeasurement,
}));

import { TokenTrackerPlugin } from '../token-tracker';
import type {
  MiddlewareContext,
  MiddlewareStore,
  SDKMessage,
  SDKUsage,
} from '../../types';

function makeCtx(overrides?: Partial<MiddlewareContext>): MiddlewareContext {
  const data: Record<string, unknown> = {};
  return {
    currentPhase: 'setup',
    currentPhaseFreshContext: true,
    get<T>(key: string): T | undefined {
      return data[key] as T | undefined;
    },
    ...overrides,
  };
}

function ctxWith(get: <T>(key: string) => T | undefined): MiddlewareContext {
  return {
    currentPhase: 'setup',
    currentPhaseFreshContext: true,
    get,
  };
}

function makeStore(): MiddlewareStore & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    set(key: string, value: unknown): void {
      data[key] = value;
    },
  };
}

function assistantWithUsage(usage: SDKUsage): SDKMessage {
  return {
    type: 'assistant',
    message: { usage },
  } as SDKMessage;
}

function resultMessage(usage?: SDKUsage): SDKMessage {
  return { type: 'result', usage } as SDKMessage;
}

describe('TokenTrackerPlugin — benchmark math', () => {
  beforeEach(() => {
    setSpanMeasurement.mockClear();
  });

  it('accumulates input + output across non-duplicate assistant messages', () => {
    const plugin = new TokenTrackerPlugin();
    const ctx = makeCtx();
    const store = makeStore();

    plugin.onMessage(
      assistantWithUsage({ input_tokens: 100, output_tokens: 50 }),
      ctx,
      store,
    );
    plugin.onMessage(
      assistantWithUsage({ input_tokens: 200, output_tokens: 75 }),
      ctx,
      store,
    );

    const data = store.data.tokens as {
      totalInput: number;
      totalOutput: number;
    };
    expect(data.totalInput).toBe(300);
    expect(data.totalOutput).toBe(125);
  });

  it('folds cache_read + cache_creation into the input token total', () => {
    const plugin = new TokenTrackerPlugin();
    const ctx = makeCtx();
    const store = makeStore();

    plugin.onMessage(
      assistantWithUsage({
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 500,
      }),
      ctx,
      store,
    );

    const data = store.data.tokens as {
      totalInput: number;
      totalOutput: number;
    };
    expect(data.totalInput).toBe(1510);
    expect(data.totalOutput).toBe(5);
  });

  it('skips duplicate turns (TurnData.isDuplicate) — does not accumulate or publish', () => {
    const plugin = new TokenTrackerPlugin();
    const store = makeStore();
    const ctx = ctxWith(<T>(key: string) => {
      if (key === 'turns') return { isDuplicate: true } as unknown as T;
      return undefined;
    });

    plugin.onMessage(
      assistantWithUsage({ input_tokens: 100, output_tokens: 50 }),
      ctx,
      store,
    );

    // Early return on duplicate — store is never written, totals stay zero.
    expect(store.data.tokens).toBeUndefined();

    // Confirm by forcing a finalize: result.usage absent, lastUsage null,
    // both totals should be zero in the wizard-side measurements.
    plugin.onFinalize(resultMessage(undefined), 0, ctx, store);
    const data = store.data.tokens as {
      totalInput: number;
      totalOutput: number;
    };
    expect(data.totalInput).toBe(0);
    expect(data.totalOutput).toBe(0);
  });

  it('snapshots phase totals on phase transition and resets the phase counters', () => {
    const plugin = new TokenTrackerPlugin();
    const ctx = makeCtx();
    const store = makeStore();

    plugin.onMessage(
      assistantWithUsage({ input_tokens: 100, output_tokens: 50 }),
      ctx,
      store,
    );
    plugin.onPhaseTransition('setup', 'instrumentation', ctx, store);
    plugin.onMessage(
      assistantWithUsage({ input_tokens: 200, output_tokens: 80 }),
      ctx,
      store,
    );

    const data = store.data.tokens as {
      phaseInput: number;
      phaseOutput: number;
      totalInput: number;
      totalOutput: number;
      phaseSnapshots: Array<{
        phase: string;
        inputTokens: number;
        outputTokens: number;
      }>;
    };
    expect(data.totalInput).toBe(300);
    expect(data.totalOutput).toBe(130);
    expect(data.phaseInput).toBe(200);
    expect(data.phaseOutput).toBe(80);
    expect(data.phaseSnapshots).toHaveLength(1);
    expect(data.phaseSnapshots[0]).toMatchObject({
      phase: 'setup',
      inputTokens: 100,
      outputTokens: 50,
    });
  });
});

describe('TokenTrackerPlugin — Sentry measurements', () => {
  beforeEach(() => {
    setSpanMeasurement.mockClear();
  });

  it('emits per-bucket measurements from result.usage on finalize', () => {
    const plugin = new TokenTrackerPlugin();
    const ctx = makeCtx();
    const store = makeStore();

    plugin.onMessage(
      assistantWithUsage({ input_tokens: 100, output_tokens: 50 }),
      ctx,
      store,
    );
    plugin.onFinalize(
      resultMessage({
        input_tokens: 120,
        output_tokens: 60,
        cache_read_input_tokens: 800,
        cache_creation_input_tokens: 200,
      }),
      1234,
      ctx,
      store,
    );

    const calls = setSpanMeasurement.mock.calls;
    const byName = new Map(calls.map((c) => [c[0], c]));
    expect(byName.get('agent.tokens.input')).toEqual([
      'agent.tokens.input',
      120,
      'token',
    ]);
    expect(byName.get('agent.tokens.output')).toEqual([
      'agent.tokens.output',
      60,
      'token',
    ]);
    expect(byName.get('agent.tokens.cache_read_input')).toEqual([
      'agent.tokens.cache_read_input',
      800,
      'token',
    ]);
    expect(byName.get('agent.tokens.cache_creation_input')).toEqual([
      'agent.tokens.cache_creation_input',
      200,
      'token',
    ]);
    // Wizard-side totals always emit (covers cache reads + creates).
    expect(byName.get('agent.tokens.total_input')).toEqual([
      'agent.tokens.total_input',
      100,
      'token',
    ]);
    expect(byName.get('agent.tokens.total_output')).toEqual([
      'agent.tokens.total_output',
      50,
      'token',
    ]);
  });

  it('falls back to lastUsage when result.usage is absent', () => {
    const plugin = new TokenTrackerPlugin();
    const ctx = makeCtx();
    const store = makeStore();

    plugin.onMessage(
      assistantWithUsage({
        input_tokens: 11,
        output_tokens: 22,
        cache_read_input_tokens: 33,
        cache_creation_input_tokens: 44,
      }),
      ctx,
      store,
    );
    plugin.onFinalize(resultMessage(undefined), 100, ctx, store);

    const byName = new Map(setSpanMeasurement.mock.calls.map((c) => [c[0], c]));
    expect(byName.get('agent.tokens.input')).toEqual([
      'agent.tokens.input',
      11,
      'token',
    ]);
    expect(byName.get('agent.tokens.cache_read_input')).toEqual([
      'agent.tokens.cache_read_input',
      33,
      'token',
    ]);
  });

  it('still emits totals when no usage was ever observed', () => {
    const plugin = new TokenTrackerPlugin();
    const ctx = makeCtx();
    const store = makeStore();

    plugin.onFinalize(resultMessage(undefined), 100, ctx, store);

    const names = setSpanMeasurement.mock.calls.map((c) => c[0]);
    // No per-bucket measurements (no usage seen), but wizard totals always fire.
    expect(names).not.toContain('agent.tokens.input');
    expect(names).toContain('agent.tokens.total_input');
    expect(names).toContain('agent.tokens.total_output');
  });

  it('does not disturb the existing benchmark snapshot store payload', () => {
    const plugin = new TokenTrackerPlugin();
    const ctx = makeCtx();
    const store = makeStore();

    plugin.onMessage(
      assistantWithUsage({ input_tokens: 10, output_tokens: 20 }),
      ctx,
      store,
    );
    plugin.onFinalize(
      resultMessage({ input_tokens: 99, output_tokens: 99 }),
      0,
      ctx,
      store,
    );

    const data = store.data.tokens as {
      totalInput: number;
      totalOutput: number;
      phaseSnapshots: unknown[];
    };
    // Math is computed from assistant deltas, NOT from result.usage — that's
    // existing behavior. Sentry measurements must not bleed into it.
    expect(data.totalInput).toBe(10);
    expect(data.totalOutput).toBe(20);
    expect(data.phaseSnapshots.length).toBeGreaterThanOrEqual(1);
  });
});
