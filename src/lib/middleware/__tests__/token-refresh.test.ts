import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createTokenRefreshMiddleware,
  CHECK_INTERVAL_MS,
} from '../token-refresh.js';
import type { SDKMessage } from '../types.js';

const { refreshTokenIfStale } = vi.hoisted(() => ({
  refreshTokenIfStale: vi.fn(),
}));

vi.mock('../../../utils/token-refresh.js', () => ({
  refreshTokenIfStale,
}));

vi.mock('../../../utils/debug.js', () => ({ logToFile: vi.fn() }));
vi.mock('../../../utils/analytics.js', () => ({
  analytics: { wizardCapture: vi.fn() },
}));

function assistantMessage(): SDKMessage {
  return { type: 'assistant', message: { content: [] } } as SDKMessage;
}

describe('createTokenRefreshMiddleware', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refreshTokenIfStale.mockReset();
    refreshTokenIfStale.mockImplementation(async (current: string) => current);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ignores non-assistant messages', async () => {
    const mw = createTokenRefreshMiddleware({
      getToken: () => 'tok',
      onTokenRefreshed: vi.fn(),
    });
    mw.onMessage!(
      { type: 'system', subtype: 'api_retry' } as SDKMessage,
      {} as never,
      {} as never,
    );
    mw.onMessage!(
      { type: 'user', message: { content: 'hi' } } as SDKMessage,
      {} as never,
      {} as never,
    );
    mw.onMessage!({ type: 'result' } as SDKMessage, {} as never, {} as never);
    await vi.runAllTimersAsync();
    expect(refreshTokenIfStale).not.toHaveBeenCalled();
  });

  it('calls refreshTokenIfStale on the first assistant message', async () => {
    const mw = createTokenRefreshMiddleware({
      getToken: () => 'current-tok',
      onTokenRefreshed: vi.fn(),
    });
    mw.onMessage!(assistantMessage(), {} as never, {} as never);
    await vi.runAllTimersAsync();
    expect(refreshTokenIfStale).toHaveBeenCalledWith('current-tok', 'mid-run');
  });

  it('throttles refresh checks within CHECK_INTERVAL_MS', async () => {
    const mw = createTokenRefreshMiddleware({
      getToken: () => 'tok',
      onTokenRefreshed: vi.fn(),
    });
    mw.onMessage!(assistantMessage(), {} as never, {} as never);
    await vi.runAllTimersAsync();
    refreshTokenIfStale.mockClear();

    vi.advanceTimersByTime(CHECK_INTERVAL_MS - 1);
    mw.onMessage!(assistantMessage(), {} as never, {} as never);
    await vi.runAllTimersAsync();
    expect(refreshTokenIfStale).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    mw.onMessage!(assistantMessage(), {} as never, {} as never);
    await vi.runAllTimersAsync();
    expect(refreshTokenIfStale).toHaveBeenCalledOnce();
  });

  it('invokes onTokenRefreshed when the token rotates', async () => {
    const onTokenRefreshed = vi.fn();
    refreshTokenIfStale.mockResolvedValue('fresh-tok');
    const mw = createTokenRefreshMiddleware({
      getToken: () => 'stale-tok',
      onTokenRefreshed,
    });
    mw.onMessage!(assistantMessage(), {} as never, {} as never);
    await vi.runAllTimersAsync();
    expect(onTokenRefreshed).toHaveBeenCalledWith('fresh-tok');
  });

  it('does not invoke onTokenRefreshed when the token is unchanged', async () => {
    const onTokenRefreshed = vi.fn();
    refreshTokenIfStale.mockResolvedValue('same-tok');
    const mw = createTokenRefreshMiddleware({
      getToken: () => 'same-tok',
      onTokenRefreshed,
    });
    mw.onMessage!(assistantMessage(), {} as never, {} as never);
    await vi.runAllTimersAsync();
    expect(onTokenRefreshed).not.toHaveBeenCalled();
  });

  it('reads the latest token via getToken on each check', async () => {
    let token = 'v1';
    refreshTokenIfStale.mockImplementation(async (current) => current);
    const mw = createTokenRefreshMiddleware({
      getToken: () => token,
      onTokenRefreshed: vi.fn(),
    });
    mw.onMessage!(assistantMessage(), {} as never, {} as never);
    await vi.runAllTimersAsync();
    expect(refreshTokenIfStale).toHaveBeenCalledWith('v1', 'mid-run');

    token = 'v2';
    vi.advanceTimersByTime(CHECK_INTERVAL_MS);
    mw.onMessage!(assistantMessage(), {} as never, {} as never);
    await vi.runAllTimersAsync();
    expect(refreshTokenIfStale).toHaveBeenLastCalledWith('v2', 'mid-run');
  });

  it('swallows refresh errors without throwing', async () => {
    const onTokenRefreshed = vi.fn();
    refreshTokenIfStale.mockRejectedValue(new Error('oauth down'));
    const mw = createTokenRefreshMiddleware({
      getToken: () => 'tok',
      onTokenRefreshed,
    });
    expect(() =>
      mw.onMessage!(assistantMessage(), {} as never, {} as never),
    ).not.toThrow();
    await vi.runAllTimersAsync();
    expect(onTokenRefreshed).not.toHaveBeenCalled();
  });

  it('skips a new check while a refresh is in flight', async () => {
    let resolveRefresh!: (value: string) => void;
    refreshTokenIfStale.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const onTokenRefreshed = vi.fn();
    const mw = createTokenRefreshMiddleware({
      getToken: () => 'tok',
      onTokenRefreshed,
    });

    mw.onMessage!(assistantMessage(), {} as never, {} as never);
    mw.onMessage!(assistantMessage(), {} as never, {} as never);
    expect(refreshTokenIfStale).toHaveBeenCalledTimes(1);

    resolveRefresh('tok');
    await vi.runAllTimersAsync();
    expect(onTokenRefreshed).not.toHaveBeenCalled();
  });

  it('captures analytics when the token rotates', async () => {
    const { analytics } = await import('../../../utils/analytics.js');
    refreshTokenIfStale.mockResolvedValue('rotated');
    const mw = createTokenRefreshMiddleware({
      getToken: () => 'old',
      onTokenRefreshed: vi.fn(),
    });
    mw.onMessage!(assistantMessage(), {} as never, {} as never);
    await vi.runAllTimersAsync();
    expect(analytics.wizardCapture).toHaveBeenCalledWith(
      'auth refreshed silently',
      { label: 'mid-run' },
    );
  });
});
