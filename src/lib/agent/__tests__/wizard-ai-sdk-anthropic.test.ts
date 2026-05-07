import { afterEach, describe, expect, it, vi } from 'vitest';

describe('resolveAnthropicAuth', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('prefers ANTHROPIC_API_KEY over ANTHROPIC_AUTH_TOKEN', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'api');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'bearer');
    const { resolveAnthropicAuth } = await import('../anthropic-auth.js');
    expect(resolveAnthropicAuth()).toEqual({ apiKey: 'api' });
  });

  it('falls back to ANTHROPIC_AUTH_TOKEN', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', undefined);
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'bearer');
    const { resolveAnthropicAuth } = await import('../anthropic-auth.js');
    expect(resolveAnthropicAuth()).toEqual({
      authToken: 'bearer',
    });
  });
});
