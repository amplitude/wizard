/**
 * ScriptedAgentDriver — a deterministic test driver for the AgentDriver
 * port (`./agent-driver.ts`).
 *
 * Pairs with `setAgentDriver` to feed a canned message sequence through
 * the rest of `runAgent` (hooks, journey classifier, NDJSON emission,
 * retry/stall logic). The driver records every call it received so a
 * test can assert on what the wizard built — model, system prompt,
 * MCP servers, hooks attached, env propagated — without spinning up
 * the real Claude Agent SDK or its child process.
 *
 * Why not just use the global vitest mock?
 *   `vitest.config.ts` aliases the SDK module to `__mocks__/@anthropic-
 *   ai/claude-agent-sdk.ts` which yields a fixed two-message sequence.
 *   That's fine for unit tests that don't care about agent output, but
 *   scenario tests need to script per-test sequences (tool calls in a
 *   specific order, error paths, multi-turn flows). The scripted driver
 *   is process-scoped and overrides the global alias so each test gets
 *   exactly the sequence it asked for.
 *
 * Usage:
 *
 *   import { setAgentDriver } from './agent-driver';
 *   import { createScriptedDriver, mk } from './scripted-agent-driver';
 *
 *   beforeEach(() => {
 *     const driver = createScriptedDriver({
 *       messages: [
 *         mk.systemInit({ model: 'claude-sonnet-4-6' }),
 *         mk.assistantText('Looking at the project...'),
 *         mk.resultSuccess('Done'),
 *       ],
 *     });
 *     setAgentDriver(driver);
 *   });
 *   afterEach(() => setAgentDriver(null));
 *
 *   // Then run any code path that resolves the driver via getAgentDriver.
 *   // Inspect `driver.calls` to assert on what the wizard sent in.
 */

import type { AgentDriver, AgentDriverArgs } from './agent-driver';

export interface ScriptedAgentDriverOptions {
  /**
   * Messages the driver yields, in order. Each shape matches what the
   * Claude Agent SDK's `query()` would return — typically a sequence of
   * `system { subtype: 'init' }`, optional `assistant` / `user` /
   * `stream_event` envelopes, and a terminal `result` message.
   *
   * The driver's iteration semantics match the real SDK: the `for await`
   * consumer in `runAgent` walks until exhaustion. If the consumer aborts
   * via the abort signal carried in `args.options.abortSignal`, we stop
   * yielding and resolve cleanly.
   */
  messages: ReadonlyArray<unknown>;
  /**
   * Optional inspection hook fired the moment the driver is invoked,
   * before any messages are yielded. Lets a test snapshot the args the
   * wizard built — model selection, mcpServers, hooks, env — without
   * mutating them.
   */
  onCall?: (args: AgentDriverArgs) => void;
  /**
   * When set, the driver throws this error after yielding all `messages`.
   * Use for testing error-path behavior (auth failure, gateway hang).
   * The error fires during `for await`, not at construction time.
   */
  errorAfterMessages?: Error;
}

export interface ScriptedAgentDriverHandle {
  /** The driver function — pass to `setAgentDriver`. */
  driver: AgentDriver;
  /**
   * Args passed by every call. Length === how many times the wizard
   * (re)started the SDK loop in this test (`runAgent` retries each
   * attempt → multiple calls).
   */
  calls: AgentDriverArgs[];
}

export function createScriptedDriver(
  options: ScriptedAgentDriverOptions,
): ScriptedAgentDriverHandle {
  const calls: AgentDriverArgs[] = [];
  const driver: AgentDriver = (args) => {
    calls.push(args);
    options.onCall?.(args);
    return makeIterator(options, args);
  };
  return { driver, calls };
}

async function* makeIterator(
  options: ScriptedAgentDriverOptions,
  args: AgentDriverArgs,
): AsyncGenerator<unknown, void> {
  const signal = (args.options as { abortSignal?: AbortSignal } | undefined)
    ?.abortSignal;
  for (const message of options.messages) {
    if (signal?.aborted) return;
    // Microtask break between yields so consumers see the same
    // event-loop interleaving they'd see from the real SDK iterator —
    // any logic that races a tool result against an abort signal will
    // exercise the same race window here.
    await Promise.resolve();
    yield message;
  }
  if (options.errorAfterMessages) throw options.errorAfterMessages;
}

/**
 * Convenience constructors for the most common SDK message shapes. Pure
 * factories — no hidden state, no defaults that change per call. Tests
 * compose these into the `messages` array they pass to
 * `createScriptedDriver`.
 *
 * The shapes mirror what the real `@anthropic-ai/claude-agent-sdk`
 * yields. Fields the wizard's `runAgent` doesn't read are omitted to
 * keep test fixtures terse — extend the helpers if your scenario needs
 * something more.
 */
export const mk = {
  /** SDK init envelope — fires once at the start of every real run. */
  systemInit(opts: { model?: string; tools?: string[] } = {}): {
    type: 'system';
    subtype: 'init';
    model: string;
    tools: string[];
    mcp_servers: unknown[];
  } {
    return {
      type: 'system',
      subtype: 'init',
      model: opts.model ?? 'claude-sonnet-4-6',
      tools: opts.tools ?? [],
      mcp_servers: [],
    };
  },

  /**
   * Plain text assistant message. The wizard's `for await` loop concats
   * `text` blocks into `collectedText` and matches against
   * `AgentSignals.WIZARD_REMARK`, so include the marker if the test
   * exercises that path.
   */
  assistantText(text: string): {
    type: 'assistant';
    message: { content: Array<{ type: 'text'; text: string }> };
  } {
    return {
      type: 'assistant',
      message: { content: [{ type: 'text', text }] },
    };
  },

  /** Successful terminal result. Mirrors `result { subtype: 'success' }`. */
  resultSuccess(text?: string): {
    type: 'result';
    subtype: 'success';
    result: string;
  } {
    return {
      type: 'result',
      subtype: 'success',
      result: text ?? 'OK',
    };
  },

  /**
   * Failed terminal result. The wizard's error classifier branches on
   * `subtype` and the surrounding `error` payload — keep `subtype`
   * accurate to what the SDK would actually emit.
   */
  resultError(opts: { subtype: string; errors?: string[] }): {
    type: 'result';
    subtype: string;
    errors: string[];
  } {
    return {
      type: 'result',
      subtype: opts.subtype,
      errors: opts.errors ?? [],
    };
  },
};
