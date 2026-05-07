import { afterEach, describe, expect, it, vi } from 'vitest';

describe('resolveAnthropicAuth', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('returns the API key when ANTHROPIC_API_KEY is set', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test-api-key');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '');
    const { resolveAnthropicAuth } = await import('../anthropic-auth.js');
    expect(resolveAnthropicAuth()).toEqual({ apiKey: 'sk-test-api-key' });
  });

  it('returns the auth token when only ANTHROPIC_AUTH_TOKEN is set', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'oauth-token-xyz');
    const { resolveAnthropicAuth } = await import('../anthropic-auth.js');
    expect(resolveAnthropicAuth()).toEqual({ authToken: 'oauth-token-xyz' });
  });

  it('returns an empty object when neither variable is set', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '');
    const { resolveAnthropicAuth } = await import('../anthropic-auth.js');
    expect(resolveAnthropicAuth()).toEqual({});
  });

  it('prefers ANTHROPIC_API_KEY when both variables are set', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-wins');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'should-be-ignored');
    const { resolveAnthropicAuth } = await import('../anthropic-auth.js');
    expect(resolveAnthropicAuth()).toEqual({ apiKey: 'sk-wins' });
  });

  it('treats whitespace-only values as unset', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '   ');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '\t\n');
    const { resolveAnthropicAuth } = await import('../anthropic-auth.js');
    expect(resolveAnthropicAuth()).toEqual({});
  });
});
