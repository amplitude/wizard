import { describe, it, expect } from 'vitest';
import { sanitizeNestedClaudeEnv } from '../sanitize-claude-env.js';

describe('sanitizeNestedClaudeEnv', () => {
  it('is a no-op on clean env', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
    const result = sanitizeNestedClaudeEnv(env);
    expect(result.cleared).toEqual([]);
    expect(env).toEqual({ PATH: '/usr/bin' });
  });

  it('strips known Claude Code CLI vars', () => {
    const env: NodeJS.ProcessEnv = {
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-inherited',
      PATH: '/usr/bin',
    };
    const result = sanitizeNestedClaudeEnv(env);
    expect(result.cleared).toContain('CLAUDECODE');
    expect(result.cleared).toContain('CLAUDE_CODE_ENTRYPOINT');
    expect(result.cleared).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
  });

  it('strips Claude Agent SDK vars', () => {
    const env: NodeJS.ProcessEnv = {
      CLAUDE_AGENT_SDK_VERSION: '0.1.2',
      DEBUG_CLAUDE_AGENT_SDK: 'true',
    };
    const result = sanitizeNestedClaudeEnv(env);
    expect(result.cleared).toContain('CLAUDE_AGENT_SDK_VERSION');
    expect(result.cleared).toContain('DEBUG_CLAUDE_AGENT_SDK');
    expect(env.CLAUDE_AGENT_SDK_VERSION).toBeUndefined();
    expect(env.DEBUG_CLAUDE_AGENT_SDK).toBeUndefined();
  });

  it('returns only the keys that were actually present', () => {
    const env: NodeJS.ProcessEnv = {
      CLAUDECODE: '1',
      PATH: '/usr/bin',
    };
    const result = sanitizeNestedClaudeEnv(env);
    expect(result.cleared).toEqual(['CLAUDECODE']);
  });

  it('does not touch ANTHROPIC_API_KEY (user intent)', () => {
    const env: NodeJS.ProcessEnv = {
      ANTHROPIC_API_KEY: 'sk-user-key',
      CLAUDECODE: '1',
    };
    sanitizeNestedClaudeEnv(env);
    expect(env.ANTHROPIC_API_KEY).toBe('sk-user-key');
  });

  it('does not touch ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN (overwritten downstream)', () => {
    const env: NodeJS.ProcessEnv = {
      ANTHROPIC_BASE_URL: 'https://example.com',
      ANTHROPIC_AUTH_TOKEN: 'inherited',
      CLAUDECODE: '1',
    };
    sanitizeNestedClaudeEnv(env);
    expect(env.ANTHROPIC_BASE_URL).toBe('https://example.com');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('inherited');
  });

  it('is idempotent across multiple calls', () => {
    const env: NodeJS.ProcessEnv = {
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
    };
    const first = sanitizeNestedClaudeEnv(env);
    expect(first.cleared.length).toBe(2);
    const second = sanitizeNestedClaudeEnv(env);
    expect(second.cleared).toEqual([]);
  });

  it('defaults to process.env when no arg provided', () => {
    const originalValue = process.env.CLAUDE_CODE_SSE_PORT;
    process.env.CLAUDE_CODE_SSE_PORT = '12345';
    try {
      const result = sanitizeNestedClaudeEnv();
      expect(result.cleared).toContain('CLAUDE_CODE_SSE_PORT');
      expect(process.env.CLAUDE_CODE_SSE_PORT).toBeUndefined();
    } finally {
      if (originalValue !== undefined) {
        process.env.CLAUDE_CODE_SSE_PORT = originalValue;
      }
    }
  });
});
