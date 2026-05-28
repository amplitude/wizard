import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createTokenRefreshMiddleware,
  CHECK_INTERVAL_MS,
} from '../token-refresh.js';
import type { SDKMessage } from '../types.js';

const { refreshTokenIfStale, refreshGatewayBearer } = vi.hoisted(() => ({
  refreshTokenIfStale: vi.fn(),
  refreshGatewayBearer: vi.fn(),
}));

vi.mock('../../../utils/token-refresh.js', () => ({
  refreshTokenIfStale,
}));

vi.mock('../../llm-gateway-bearer-refresh.js', () => ({
  refreshGatewayBearer,
}));

vi.mock('../../../utils/debug.js', () => ({ logToFile: vi.fn() }));
vi.mock('../../../utils/analytics.js', () => ({
  analytics: { wizardCapture: vi.fn() },
}));

function assistantMessage(): SDKMessage {
  return { type: 'assistant', message: { content: [] } } as SDKMessage;
}

describe('createTokenRefreshMiddleware', () => {
  const ORIGINAL_AUTH = process.env.ANTHROPIC_AUTH_TOKEN;

  beforeEach(() => {
    vi.useFakeTimers();
    refreshTokenIfStale.mockReset();
    refreshTokenIfStale.mockImplementation(async (current: string) => current);
    refreshGatewayBearer.mockReset();
    refreshGatewayBearer.mockResolvedValue(false);
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_AUTH === undefined) {
      delete process.env.ANTHROPIC_AUTH_TOKEN;
    } else {
      process.env.ANTHROPIC_AUTH_TOKEN = ORIGINAL_AUTH;
    }
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

  it('calls refreshGatewayBearer on the first assistant message', async () => {
    const mw = createTokenRefreshMiddleware({
      getToken: () => 'current-tok',
      onTokenRefreshed: vi.fn(),
    });
    mw.onMessage!(assistantMessage(), {} as never, {} as never);
    await vi.runAllTimersAsync();
    expect(refreshGatewayBearer).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'mid-run' }),
    );
  });

  it('throttles refresh checks within CHECK_INTERVAL_MS', async () => {
    const mw = createTokenRefreshMiddleware({
      getToken: () => 'tok',
      onTokenRefreshed: vi.fn(),
    });
    mw.onMessage!(assistantMessage(), {} as never, {} as never);
    await vi.runAllTimersAsync();
    refreshGatewayBearer.mockClear();

    vi.advanceTimersByTime(CHECK_INTERVAL_MS - 1);
    mw.onMessage!(assistantMessage(), {} as never, {} as never);
    await vi.runAllTimersAsync();
    expect(refreshGatewayBearer).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    mw.onMessage!(assistantMessage(), {} as never, {} as never);
    await vi.runAllTimersAsync();
    expect(refreshGatewayBearer).toHaveBeenCalledOnce();
  });

  it('invokes onTokenRefreshed when the token rotates', async () => {
    const onTokenRefreshed = vi.fn();
    refreshGatewayBearer.mockResolvedValue(true);
    process.env.ANTHROPIC_AUTH_TOKEN = 'fresh-tok';
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
    const mw = createTokenRefreshMiddleware({
      getToken: () => token,
      onTokenRefreshed: vi.fn(),
    });
    mw.onMessage!(assistantMessage(), {} as never, {} as never);
    await vi.runAllTimersAsync();
    expect(refreshGatewayBearer).toHaveBeenCalledTimes(1);

    token = 'v2';
    vi.advanceTimersByTime(CHECK_INTERVAL_MS);
    mw.onMessage!(assistantMessage(), {} as never, {} as never);
    await vi.runAllTimersAsync();
    expect(refreshGatewayBearer).toHaveBeenCalledTimes(2);
  });

  it('swallows refresh errors without throwing', async () => {
    const onTokenRefreshed = vi.fn();
    refreshGatewayBearer.mockRejectedValue(new Error('oauth down'));
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
    let resolveRefresh!: (value: boolean) => void;
    refreshGatewayBearer.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
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
    expect(refreshGatewayBearer).toHaveBeenCalledTimes(1);

    resolveRefresh(false);
    await vi.runAllTimersAsync();
    expect(onTokenRefreshed).not.toHaveBeenCalled();
  });

  it('calls onTokenRefreshed when env token differs after non-rotation', async () => {
    const onTokenRefreshed = vi.fn();
    refreshGatewayBearer.mockResolvedValue(false);
    process.env.ANTHROPIC_AUTH_TOKEN = 'external-fresh';
    const mw = createTokenRefreshMiddleware({
      getToken: () => 'stale-in-memory',
      onTokenRefreshed,
    });
    mw.onMessage!(assistantMessage(), {} as never, {} as never);
    await vi.runAllTimersAsync();
    expect(onTokenRefreshed).toHaveBeenCalledWith('external-fresh');
  });
});
