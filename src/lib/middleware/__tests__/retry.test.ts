import { describe, it, expect, vi } from 'vitest';
import { createRetryMiddleware, createStormAnchor } from '../retry.js';
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

  it('anchors startedAt to the first retry of a storm, not each individual message', async () => {
    // The UI grace period needs to measure "this storm has been going on
    // for 3s" — if startedAt reset on every retry, a sustained 429 storm
    // would never show the banner because the latest message keeps
    // resetting the clock.
    const onState = vi.fn();
    const mw = createRetryMiddleware(onState);
    mw.onMessage!(apiRetryMessage({ attempt: 0 }), {} as never, {} as never);
    const firstStart = onState.mock.calls[0][0].startedAt;
    // Yield to the event loop so Date.now() advances by ≥ 1ms even on
    // fast machines — without this the test could pass spuriously.
    await new Promise((resolve) => setTimeout(resolve, 5));
    mw.onMessage!(apiRetryMessage({ attempt: 1 }), {} as never, {} as never);
    mw.onMessage!(apiRetryMessage({ attempt: 2 }), {} as never, {} as never);
    expect(onState.mock.calls[1][0].startedAt).toBe(firstStart);
    expect(onState.mock.calls[2][0].startedAt).toBe(firstStart);
  });

  it('resets the storm anchor after a normal message clears the retry state', async () => {
    const onState = vi.fn();
    const mw = createRetryMiddleware(onState);
    mw.onMessage!(apiRetryMessage({ attempt: 0 }), {} as never, {} as never);
    const firstStart = onState.mock.calls[0][0].startedAt;
    // Resolve the storm.
    mw.onMessage!(
      { type: 'assistant', message: { content: [] } } as SDKMessage,
      {} as never,
      {} as never,
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    // New storm starts.
    mw.onMessage!(apiRetryMessage({ attempt: 0 }), {} as never, {} as never);
    const secondStart =
      onState.mock.calls[onState.mock.calls.length - 1][0].startedAt;
    expect(secondStart).toBeGreaterThan(firstStart);
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

describe('createStormAnchor', () => {
  // The storm anchor is shared between `createRetryMiddleware` and
  // `publishRetryBanner` (in `agent-interface.ts`). Both paths produce
  // RetryStates whose `startedAt` feeds the UI grace period — if either
  // path resamples `Date.now()` on each call, the chip never appears
  // during rapid retry storms (Cursor Bugbot caught exactly this regression
  // on the first revision of this PR — see PR #286).

  it('stamps once and reuses the same timestamp for subsequent calls', async () => {
    const anchor = createStormAnchor();
    const first = anchor.stamp();
    await new Promise((r) => setTimeout(r, 5));
    const second = anchor.stamp();
    const third = anchor.stamp();
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('starts a fresh storm after reset()', async () => {
    const anchor = createStormAnchor();
    const first = anchor.stamp();
    anchor.reset();
    await new Promise((r) => setTimeout(r, 5));
    const second = anchor.stamp();
    expect(second).toBeGreaterThan(first);
  });

  it('isolates state between separate anchors', () => {
    const a = createStormAnchor();
    const b = createStormAnchor();
    a.stamp();
    a.reset();
    // b should still be unstamped — independent storms, independent state.
    const bFirst = b.stamp();
    expect(bFirst).toBeGreaterThan(0);
  });
});
