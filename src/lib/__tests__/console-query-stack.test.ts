import { describe, it, expect, afterEach } from 'vitest';

import { getConsoleQueryStack } from '../agent/console-query-stack.js';
import type { AgentRunConfig } from '../agent-interface.js';

function baseConfig(
  overrides: Partial<AgentRunConfig> = {},
): AgentRunConfig {
  return {
    workingDirectory: '/tmp',
    mcpServers: {},
    model: 'anthropic/claude-sonnet-4-6',
    ...overrides,
  };
}

describe('getConsoleQueryStack', () => {
  afterEach(() => {
    delete process.env.AMPLITUDE_WIZARD_AI_SDK_CONSOLE;
  });

  it('defaults to Agent SDK when AMPLITUDE_WIZARD_AI_SDK_CONSOLE is unset', () => {
    expect(getConsoleQueryStack(baseConfig())).toBe('claude-agent-sdk');
  });

  it('uses Vercel AI SDK when opt-in is set and not local CLI', () => {
    process.env.AMPLITUDE_WIZARD_AI_SDK_CONSOLE = '1';
    expect(getConsoleQueryStack(baseConfig({ useLocalClaude: false }))).toBe(
      'vercel-ai-sdk',
    );
  });

  it('keeps Agent SDK for local Claude runs even when opt-in is set', () => {
    process.env.AMPLITUDE_WIZARD_AI_SDK_CONSOLE = '1';
    expect(getConsoleQueryStack(baseConfig({ useLocalClaude: true }))).toBe(
      'claude-agent-sdk',
    );
  });
});
