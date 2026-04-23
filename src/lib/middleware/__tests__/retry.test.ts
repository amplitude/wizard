import { describe, it, expect, vi } from 'vitest';
import { createRetryMiddleware } from '../retry.js';
import type { SDKMessage } from '../types.js';

function apiRetryMessage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    type: 'system',
    subtype: 'api_retry',
    attempt: 2,
    max_retries: 10,
    retry_delay_ms: 2000,
    error_status: 504,
    ...overrides,
  } as SDKMessage;
}

describe('createRetryMiddleware', () => {
  it('publishes a RetryState when an api_retry message arrives', () => {
    const onState = vi.fn();
    const mw = createRetryMiddleware(onState);
    mw.onMessage!(apiRetryMessage(), {} as never, {} as never);
    expect(onState).toHaveBeenCalledTimes(1);
    const state = onState.mock.calls[0][0];
    // SDK reports 0-based attempt, we display 1-indexed (+1).
    expect(state.attempt).toBe(3);
    expect(state.maxRetries).toBe(10);
    expect(state.errorStatus).toBe(504);
    expect(state.reason).toBe('Amplitude gateway error');
    expect(state.nextRetryAtMs).toBeGreaterThanOrEqual(state.startedAt);
  });

  it('clears state when a non-retry message arrives after a retry', () => {
    const onState = vi.fn();
    const mw = createRetryMiddleware(onState);
    mw.onMessage!(apiRetryMessage(), {} as never, {} as never);
    onState.mockClear();
    mw.onMessage!(
      { type: 'assistant', message: { content: [] } } as SDKMessage,
      {} as never,
      {} as never,
    );
    expect(onState).toHaveBeenCalledTimes(1);
    expect(onState).toHaveBeenCalledWith(null);
  });

  it('does not fire with null if no retry was ever active', () => {
    const onState = vi.fn();
    const mw = createRetryMiddleware(onState);
    mw.onMessage!(
      { type: 'assistant', message: { content: [] } } as SDKMessage,
      {} as never,
      {} as never,
    );
    expect(onState).not.toHaveBeenCalled();
  });

  it('ignores non-api_retry system messages', () => {
    const onState = vi.fn();
    const mw = createRetryMiddleware(onState);
    mw.onMessage!(
      { type: 'system', subtype: 'init' } as SDKMessage,
      {} as never,
      {} as never,
    );
    expect(onState).not.toHaveBeenCalled();
  });

  it('publishes again for each consecutive api_retry without an intervening null', () => {
    const onState = vi.fn();
    const mw = createRetryMiddleware(onState);
    mw.onMessage!(apiRetryMessage({ attempt: 0 }), {} as never, {} as never);
    mw.onMessage!(apiRetryMessage({ attempt: 1 }), {} as never, {} as never);
    mw.onMessage!(apiRetryMessage({ attempt: 2 }), {} as never, {} as never);
    expect(onState).toHaveBeenCalledTimes(3);
    expect(onState.mock.calls.every(([s]) => s !== null)).toBe(true);
  });

  it('falls back when the SDK omits fields', () => {
    const onState = vi.fn();
    const mw = createRetryMiddleware(onState);
    mw.onMessage!(
      { type: 'system', subtype: 'api_retry' } as SDKMessage,
      {} as never,
      {} as never,
    );
    const state = onState.mock.calls[0][0];
    expect(state.attempt).toBe(1);
    expect(state.maxRetries).toBe(10);
    expect(state.errorStatus).toBeNull();
  });
});
