/**
 * Tests for the mid-run LLM gateway bearer refresh helper.
 *
 * Pins the contract that the periodic timer (and the per-attempt
 * call) actually rotates the bearer when the stored token is within
 * `EXPIRY_BUFFER_MS` of expiry — the post-mortem case where a 35-min
 * agent run died on `400 authentication_error: Token revoked or
 * expired` because nothing refreshed the gateway bearer mid-attempt.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  applyRotatedBearer,
  refreshGatewayBearer,
  startGatewayBearerRefreshTimer,
} from '../llm-gateway-bearer-refresh.js';

vi.mock('../../utils/debug.js', () => ({
  logToFile: vi.fn(),
}));

const ORIGINAL_AUTH = process.env.ANTHROPIC_AUTH_TOKEN;
const ORIGINAL_OAUTH = process.env.CLAUDE_CODE_OAUTH_TOKEN;

beforeEach(() => {
  process.env.ANTHROPIC_AUTH_TOKEN = 'stale-bearer';
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'stale-bearer';
});

afterEach(() => {
  if (ORIGINAL_AUTH === undefined) {
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  } else {
    process.env.ANTHROPIC_AUTH_TOKEN = ORIGINAL_AUTH;
  }
  if (ORIGINAL_OAUTH === undefined) {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  } else {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = ORIGINAL_OAUTH;
  }
});

describe('applyRotatedBearer', () => {
  it('mirrors the new bearer onto both env vars and the MCP header', () => {
    const mcpServers = {
      'amplitude-wizard': { headers: { Authorization: 'Bearer stale' } },
    };
    const updateAmplitudeMcpBearer = vi.fn(
      (servers: Record<string, unknown>, next: string) => {
        const entry = servers['amplitude-wizard'] as {
          headers: Record<string, string>;
        };
        entry.headers.Authorization = `Bearer ${next}`;
        return true;
      },
    );

    applyRotatedBearer({
      fresh: 'fresh-bearer',
      mcpServers,
      updateAmplitudeMcpBearer,
    });

    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe('fresh-bearer');
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('fresh-bearer');
    expect(updateAmplitudeMcpBearer).toHaveBeenCalledWith(
      mcpServers,
      'fresh-bearer',
    );
    expect(
      (mcpServers['amplitude-wizard'] as { headers: { Authorization: string } })
        .headers.Authorization,
    ).toBe('Bearer fresh-bearer');
  });
});

describe('refreshGatewayBearer', () => {
  it('rotates env + MCP headers when the OAuth path returns a new bearer', async () => {
    const mcpServers = {
      'amplitude-wizard': { headers: { Authorization: 'Bearer stale-bearer' } },
    };
    const updateAmplitudeMcpBearer = vi.fn(() => true);
    const onRotated = vi.fn();
    const refreshTokenIfStale = vi.fn(async () => 'fresh-bearer');

    const rotated = await refreshGatewayBearer({
      label: 'pre-attempt',
      mcpServers,
      refreshTokenIfStale,
      updateAmplitudeMcpBearer,
      onRotated,
    });

    expect(rotated).toBe(true);
    expect(refreshTokenIfStale).toHaveBeenCalledWith(
      'stale-bearer',
      'pre-attempt',
    );
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe('fresh-bearer');
    expect(updateAmplitudeMcpBearer).toHaveBeenCalledWith(
      mcpServers,
      'fresh-bearer',
    );
    expect(onRotated).toHaveBeenCalledOnce();
  });

  it('is a no-op when the OAuth path returns the same bearer (still fresh)', async () => {
    const updateAmplitudeMcpBearer = vi.fn(() => true);
    const onRotated = vi.fn();
    const refreshTokenIfStale = vi.fn(async (current: string) => current);

    const rotated = await refreshGatewayBearer({
      label: 'mid-run-timer',
      refreshTokenIfStale,
      updateAmplitudeMcpBearer,
      onRotated,
    });

    expect(rotated).toBe(false);
    expect(updateAmplitudeMcpBearer).not.toHaveBeenCalled();
    expect(onRotated).not.toHaveBeenCalled();
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe('stale-bearer');
  });

  it('returns false (and does not throw) when the OAuth path errors', async () => {
    const updateAmplitudeMcpBearer = vi.fn(() => true);
    const refreshTokenIfStale = vi.fn(async () => {
      throw new Error('network down');
    });

    const rotated = await refreshGatewayBearer({
      label: 'mid-run-timer',
      refreshTokenIfStale,
      updateAmplitudeMcpBearer,
    });

    expect(rotated).toBe(false);
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe('stale-bearer');
  });

  it('returns false when ANTHROPIC_AUTH_TOKEN is unset (e.g. direct API path)', async () => {
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    const refreshTokenIfStale = vi.fn(async () => 'should-not-be-called');
    const updateAmplitudeMcpBearer = vi.fn(() => true);

    const rotated = await refreshGatewayBearer({
      label: 'mid-run-timer',
      refreshTokenIfStale,
      updateAmplitudeMcpBearer,
    });

    expect(rotated).toBe(false);
    expect(refreshTokenIfStale).not.toHaveBeenCalled();
  });
});

describe('startGatewayBearerRefreshTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('triggers a refresh on the configured interval and applies the new bearer', async () => {
    const mcpServers = {
      'amplitude-wizard': { headers: { Authorization: 'Bearer stale-bearer' } },
    };
    const updateAmplitudeMcpBearer = vi.fn(
      (servers: Record<string, unknown>, next: string) => {
        const entry = servers['amplitude-wizard'] as {
          headers: Record<string, string>;
        };
        entry.headers.Authorization = `Bearer ${next}`;
        return true;
      },
    );
    const onRotated = vi.fn();
    // Simulate a near-expiry bearer: `refreshTokenIfStale` returns a
    // freshly-rotated value the first time it's invoked.
    const refreshTokenIfStale = vi
      .fn<(c: string, l: string) => Promise<string>>()
      .mockImplementation(async (current) =>
        current === 'stale-bearer' ? 'fresh-bearer' : current,
      );

    const stop = startGatewayBearerRefreshTimer({
      mcpServers,
      refreshTokenIfStale,
      updateAmplitudeMcpBearer,
      intervalMs: 60_000,
      onRotated,
    });

    // Before the first tick, no rotation has occurred.
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe('stale-bearer');

    // Advance past the interval and let the queued microtasks run.
    await vi.advanceTimersByTimeAsync(60_000);

    expect(refreshTokenIfStale).toHaveBeenCalled();
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe('fresh-bearer');
    expect(
      (mcpServers['amplitude-wizard'] as { headers: { Authorization: string } })
        .headers.Authorization,
    ).toBe('Bearer fresh-bearer');
    expect(onRotated).toHaveBeenCalled();

    stop();
  });

  it('stops firing once the returned disposer is invoked', async () => {
    const refreshTokenIfStale = vi.fn(async () => 'fresh-bearer');
    const updateAmplitudeMcpBearer = vi.fn(() => true);

    const stop = startGatewayBearerRefreshTimer({
      refreshTokenIfStale,
      updateAmplitudeMcpBearer,
      intervalMs: 1_000,
    });

    stop();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(refreshTokenIfStale).not.toHaveBeenCalled();
  });
});
