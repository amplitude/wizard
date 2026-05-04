import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AgentDriver,
  getAgentDriver,
  setAgentDriver,
} from '../agent-driver';

afterEach(() => {
  setAgentDriver(null);
  vi.doUnmock('@anthropic-ai/claude-agent-sdk');
  vi.resetModules();
});

describe('AgentDriver port', () => {
  it('returns the global SDK alias when no override is set', async () => {
    // vitest.config.ts aliases @anthropic-ai/claude-agent-sdk to
    // __mocks__/@anthropic-ai/claude-agent-sdk.ts, whose query() yields a
    // fixed two-message sequence. Asserting on that sequence proves the
    // default driver is wired through to the SDK module.
    const driver = await getAgentDriver();
    const messages: unknown[] = [];
    for await (const m of driver({ prompt: 'hello' })) messages.push(m);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ type: 'system', subtype: 'init' });
    expect(messages[1]).toMatchObject({ type: 'result', subtype: 'success' });
  });

  it('honors a setAgentDriver override and forwards args', async () => {
    const seenArgs: unknown[] = [];
    const scripted: AgentDriver = async function* (args) {
      seenArgs.push(args);
      yield { type: 'assistant' as const };
      yield { type: 'result' as const, subtype: 'success' as const };
    };
    setAgentDriver(scripted);

    const driver = await getAgentDriver();
    const messages: unknown[] = [];
    for await (const m of driver({
      prompt: 'go',
      options: { model: 'claude-sonnet' },
    })) {
      messages.push(m);
    }
    expect(messages).toEqual([
      { type: 'assistant' },
      { type: 'result', subtype: 'success' },
    ]);
    expect(seenArgs).toEqual([
      { prompt: 'go', options: { model: 'claude-sonnet' } },
    ]);
  });

  it('clears the cached promise on rejection so retries can succeed', async () => {
    // Simulates the realistic failure mode: the dynamic import resolves
    // but accessing `.query` blows up (e.g. partial install, broken
    // bundling, version skew). loadDefaultDriver's try/catch covers both
    // import rejection and post-import access, so a getter that throws is
    // a sufficient stand-in and avoids vitest's "factory threw" hoist
    // complaint that an outright import rejection triggers.
    vi.resetModules();
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
      get query() {
        throw new Error('SDK import failed');
      },
    }));

    const failingMod = await import('../agent-driver');
    await expect(failingMod.getAgentDriver()).rejects.toThrow(
      'SDK import failed',
    );

    // A second attempt against the same module instance must re-attempt
    // the import (cache cleared) rather than return the same rejection.
    // Swap to a working factory and confirm we get a usable driver back.
    vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
      query: async function* () {
        yield { type: 'system', subtype: 'init' } as const;
        yield { type: 'result', subtype: 'success' } as const;
      },
    }));

    const driver = await failingMod.getAgentDriver();
    const messages: unknown[] = [];
    for await (const m of driver({ prompt: 'retry' })) messages.push(m);
    expect(messages).toHaveLength(2);
  });

  it('restores the default driver when override is cleared', async () => {
    const scripted: AgentDriver = async function* () {
      yield { type: 'result' as const, subtype: 'success' as const };
    };
    setAgentDriver(scripted);
    const overridden = await getAgentDriver();
    const overriddenMessages: unknown[] = [];
    for await (const m of overridden({ prompt: '' }))
      overriddenMessages.push(m);
    expect(overriddenMessages).toHaveLength(1);

    setAgentDriver(null);
    const restored = await getAgentDriver();
    const restoredMessages: unknown[] = [];
    for await (const m of restored({ prompt: '' })) restoredMessages.push(m);
    expect(restoredMessages).toHaveLength(2);
  });
});
