import { describe, it, expect } from 'vitest';
import { detectNestedAgent } from '../detect-nested-agent.js';

describe('detectNestedAgent', () => {
  it('returns null when no Claude env vars are set', () => {
    expect(detectNestedAgent({})).toBeNull();
  });

  it('detects the Claude Code CLI via CLAUDECODE=1', () => {
    const result = detectNestedAgent({ CLAUDECODE: '1' });
    expect(result).toEqual({
      signal: 'claude_code_cli',
      envVar: 'CLAUDECODE',
      envValue: '1',
    });
  });

  it('ignores CLAUDECODE when not set to "1" (avoids false positives from unrelated vars)', () => {
    expect(detectNestedAgent({ CLAUDECODE: '0' })).toBeNull();
    expect(detectNestedAgent({ CLAUDECODE: '' })).toBeNull();
  });

  it('detects the Claude Agent SDK via CLAUDE_CODE_ENTRYPOINT', () => {
    const result = detectNestedAgent({ CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' });
    expect(result).toEqual({
      signal: 'claude_agent_sdk',
      envVar: 'CLAUDE_CODE_ENTRYPOINT',
      envValue: 'sdk-ts',
    });
  });

  it('prefers the CLAUDECODE signal when both are set', () => {
    const result = detectNestedAgent({
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
    });
    expect(result?.signal).toBe('claude_code_cli');
  });

  it('honors AMPLITUDE_WIZARD_ALLOW_NESTED=1 as a bypass', () => {
    const env = {
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
      AMPLITUDE_WIZARD_ALLOW_NESTED: '1',
    };
    expect(detectNestedAgent(env)).toBeNull();
  });

  it('does not bypass on arbitrary AMPLITUDE_WIZARD_ALLOW_NESTED values', () => {
    expect(
      detectNestedAgent({
        CLAUDECODE: '1',
        AMPLITUDE_WIZARD_ALLOW_NESTED: 'true',
      }),
    ).not.toBeNull();
  });

  it('reads process.env by default', () => {
    // Whatever is in process.env, calling without args should not throw
    // and should return either null or a detection object. Don't assert
    // the actual value since test runs may or may not be nested.
    const result = detectNestedAgent();
    if (result !== null) {
      expect(['claude_code_cli', 'claude_agent_sdk']).toContain(result.signal);
    }
  });
});
