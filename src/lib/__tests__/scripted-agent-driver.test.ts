import { afterEach, describe, expect, it } from 'vitest';
import { createScriptedDriver, mk } from '../scripted-agent-driver';
import { getAgentDriver, setAgentDriver } from '../agent-driver';

afterEach(() => {
  setAgentDriver(null);
});

describe('createScriptedDriver', () => {
  it('yields the configured messages in order', async () => {
    const { driver } = createScriptedDriver({
      messages: [
        mk.systemInit({ model: 'claude-sonnet-4-6' }),
        mk.assistantText('hello'),
        mk.resultSuccess('done'),
      ],
    });
    const out: unknown[] = [];
    for await (const m of driver({ prompt: '' })) out.push(m);
    expect(out).toEqual([
      {
        type: 'system',
        subtype: 'init',
        model: 'claude-sonnet-4-6',
        tools: [],
        mcp_servers: [],
      },
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hello' }] },
      },
      { type: 'result', subtype: 'success', result: 'done' },
    ]);
  });

  it('records every call so tests can assert on what the wizard built', async () => {
    const { driver, calls } = createScriptedDriver({
      messages: [mk.resultSuccess()],
    });
    for await (const _ of driver({
      prompt: 'go',
      options: { model: 'm1', mcpServers: { foo: { url: 'u' } } },
    })) {
      void _;
    }
    expect(calls).toEqual([
      {
        prompt: 'go',
        options: { model: 'm1', mcpServers: { foo: { url: 'u' } } },
      },
    ]);
  });

  it('throws errorAfterMessages once the message stream is exhausted', async () => {
    const { driver } = createScriptedDriver({
      messages: [mk.systemInit()],
      errorAfterMessages: new Error('boom'),
    });
    const out: unknown[] = [];
    await expect(async () => {
      for await (const m of driver({ prompt: '' })) out.push(m);
    }).rejects.toThrow('boom');
    expect(out).toHaveLength(1);
  });

  it('respects an aborted signal between yields', async () => {
    const controller = new AbortController();
    const { driver } = createScriptedDriver({
      messages: [
        mk.systemInit(),
        mk.assistantText('one'),
        mk.assistantText('two'),
        mk.resultSuccess(),
      ],
    });
    const out: unknown[] = [];
    for await (const m of driver({
      prompt: '',
      options: { abortSignal: controller.signal },
    })) {
      out.push(m);
      if (out.length === 2) controller.abort();
    }
    expect(out).toHaveLength(2);
  });

  it('plugs into the AgentDriver port via setAgentDriver', async () => {
    const { driver } = createScriptedDriver({
      messages: [mk.resultSuccess('via-port')],
    });
    setAgentDriver(driver);
    const resolved = await getAgentDriver();
    const out: unknown[] = [];
    for await (const m of resolved({ prompt: '' })) out.push(m);
    expect(out).toEqual([
      { type: 'result', subtype: 'success', result: 'via-port' },
    ]);
  });

  it('fires onCall before the first yield, with the args the wizard sent', async () => {
    const seen: unknown[] = [];
    const { driver } = createScriptedDriver({
      messages: [mk.resultSuccess()],
      onCall: (args) => seen.push(args),
    });
    for await (const _ of driver({
      prompt: 'inspect-me',
      options: { model: 'opus' },
    })) {
      void _;
    }
    expect(seen).toEqual([
      { prompt: 'inspect-me', options: { model: 'opus' } },
    ]);
  });

  it('records multiple calls when the driver is invoked twice (retry path)', async () => {
    const { driver, calls } = createScriptedDriver({
      messages: [mk.resultSuccess()],
    });
    for await (const _ of driver({ prompt: 'a' })) void _;
    for await (const _ of driver({ prompt: 'b' })) void _;
    expect(calls.map((c) => c.prompt)).toEqual(['a', 'b']);
  });
});

describe('mk', () => {
  it('mk.systemInit defaults model to claude-sonnet-4-6', () => {
    expect(mk.systemInit()).toMatchObject({
      type: 'system',
      subtype: 'init',
      model: 'claude-sonnet-4-6',
    });
  });

  it('mk.assistantText nests the text in the standard content block', () => {
    expect(mk.assistantText('hi')).toEqual({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hi' }] },
    });
  });

  it('mk.resultSuccess defaults to OK', () => {
    expect(mk.resultSuccess()).toEqual({
      type: 'result',
      subtype: 'success',
      result: 'OK',
    });
  });

  it('mk.resultError preserves the supplied subtype and errors', () => {
    expect(
      mk.resultError({ subtype: 'gateway_down', errors: ['502'] }),
    ).toEqual({
      type: 'result',
      subtype: 'gateway_down',
      errors: ['502'],
    });
  });
});
