/**
 * observability middleware — agent_metrics emission test.
 *
 * The middleware aggregates token usage, tool call counts, and run
 * duration on every agent run. At finalize time it forwards those
 * numbers to `getUI().emitAgentMetrics?.(...)` so AgentUI can ship a
 * `progress` NDJSON event for orchestrators that bill / cap / monitor
 * cost. Without this wiring, the SDK's per-message `usage` would be
 * silently discarded — the AI/agent-SDK reviewer's #1 follow-up
 * complaint.
 *
 * These tests pin the wiring contract: finalize forwards the SDK
 * result-message fields that the AgentUI emitter expects, with
 * exactly the property names declared in WizardUI.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { emitAgentMetricsMock } = vi.hoisted(() => ({
  emitAgentMetricsMock: vi.fn(),
}));

vi.mock('../../../ui', () => ({
  getUI: () => ({
    emitAgentMetrics: emitAgentMetricsMock,
  }),
}));

// Stub the rest of the observability surface — onFinalize calls a
// few of these helpers and they all hit globals (Sentry, analytics
// SDK init). Stubs let the test focus on the new agent_metrics
// forward without hauling in the full observability dependency tree.
vi.mock('../../observability/sentry', () => ({
  addBreadcrumb: vi.fn(),
  setSentryTag: vi.fn(),
  startWizardSpan: () => ({
    setAttribute: vi.fn(),
    end: vi.fn(),
  }),
}));
vi.mock('../../observability/correlation', () => ({
  rotateRunId: vi.fn(),
}));
vi.mock('../../../utils/analytics', () => ({
  analytics: {
    wizardCapture: vi.fn(),
    captureException: vi.fn(),
  },
}));
vi.mock('../../observability/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { createObservabilityMiddleware } from '../observability';
import type { SDKMessage, MiddlewareContext, MiddlewareStore } from '../types';

const stubCtx: MiddlewareContext = {
  currentPhase: 'wizard',
  currentPhaseFreshContext: true,
  get: () => undefined,
};
const stubStore: MiddlewareStore = {
  set: vi.fn(),
  get: vi.fn(),
} as unknown as MiddlewareStore;

beforeEach(() => {
  emitAgentMetricsMock.mockClear();
});

describe('observability middleware → emitAgentMetrics', () => {
  it('forwards SDK usage fields with WizardUI property names on finalize', () => {
    const m = createObservabilityMiddleware();
    m.onInit?.();
    const result: SDKMessage = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      num_turns: 8,
      total_cost_usd: 0.045,
      usage: {
        input_tokens: 5000,
        output_tokens: 1200,
        cache_read_input_tokens: 4000,
        cache_creation_input_tokens: 800,
      },
    };
    m.onFinalize?.(result, 12_500, stubCtx, stubStore);

    expect(emitAgentMetricsMock).toHaveBeenCalledTimes(1);
    expect(emitAgentMetricsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        durationMs: 12_500,
        inputTokens: 5000,
        outputTokens: 1200,
        cacheReadInputTokens: 4000,
        cacheCreationInputTokens: 800,
        costUsd: 0.045,
        numTurns: 8,
        isError: false,
      }),
    );
  });

  it('passes durationMs even when SDK omits usage fields', () => {
    const m = createObservabilityMiddleware();
    m.onInit?.();
    // Result with NO usage block — SDK didn't report token counts on
    // this run (e.g. an early error before the first assistant
    // message). Middleware should still emit metrics with
    // durationMs and isError populated; token fields stay
    // undefined so AgentUI drops them from the wire payload.
    const result: SDKMessage = {
      type: 'result',
      subtype: 'error',
      is_error: true,
    };
    m.onFinalize?.(result, 500, stubCtx, stubStore);

    expect(emitAgentMetricsMock).toHaveBeenCalledTimes(1);
    const arg = emitAgentMetricsMock.mock.calls[0][0];
    expect(arg.durationMs).toBe(500);
    expect(arg.isError).toBe(true);
    expect(arg.inputTokens).toBeUndefined();
    expect(arg.costUsd).toBeUndefined();
  });

  it('does not throw if emitAgentMetrics itself throws — finalize must complete', () => {
    emitAgentMetricsMock.mockImplementationOnce(() => {
      throw new Error('emitter blew up');
    });
    const m = createObservabilityMiddleware();
    m.onInit?.();
    const result: SDKMessage = {
      type: 'result',
      subtype: 'success',
      is_error: false,
    };
    expect(() => m.onFinalize?.(result, 100, stubCtx, stubStore)).not.toThrow();
  });
});
