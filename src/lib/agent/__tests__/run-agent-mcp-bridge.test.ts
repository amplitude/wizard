/**
 * Phase D-4 — coverage for the wizard-tools MCP bridge.
 *
 * The vitest harness aliases `@anthropic-ai/claude-agent-sdk` to a stub
 * mock (`__mocks__/@anthropic-ai/claude-agent-sdk.ts`) that returns a
 * plain `{ instance: { _registeredTools } }` shape from
 * `createSdkMcpServer` — NOT a real `McpServer` with a `.connect`
 * method. That's correct for the bulk of `wizard-tools.test.ts` (which
 * pokes at the `_registeredTools` map directly to drive tool handlers
 * one at a time) but it means we can't drive the bridge through
 * `createWizardToolsServer` here.
 *
 * Instead, this test builds a real `McpServer` directly via
 * `@modelcontextprotocol/sdk` (which IS installed and is the same
 * package the production runtime exposes through the agent SDK's
 * `createSdkMcpServer`). The bridge code under test is identical
 * either way — it depends only on the public McpServer.connect /
 * Client.callTool surface.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { streamText, stepCountIs } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { bridgeWizardToolsMcp } from '../run-agent-mcp-bridge.js';
import { WIZARD_TOOLS_SERVER_NAME } from '../../wizard-tools.js';

/**
 * Build a real `McpServer` populated with a representative slice of
 * wizard-tools-shaped tools so the bridge can list + call them. We
 * intentionally include tools the pre-D-4 native runner was missing
 * (`set_env_values`, `confirm_event_plan`, `wizard_feedback`) so the
 * test doubles as a regression guard for the schema-drift bug.
 */
function buildFixtureMcpServer(): McpServer {
  const server = new McpServer({
    name: WIZARD_TOOLS_SERVER_NAME,
    version: '1.0.0',
  });

  server.registerTool(
    'check_env_keys',
    {
      description: 'Check env keys (fixture).',
      inputSchema: {
        filePath: z.string(),
        keys: z.array(z.string()),
        reason: z.string(),
      },
    },
    (args: { filePath: string; keys: string[]; reason: string }) => {
      const result: Record<string, 'present' | 'missing'> = {};
      for (const k of args.keys) {
        result[k] = k === 'AMPLITUDE_API_KEY' ? 'present' : 'missing';
      }
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    },
  );

  server.registerTool(
    'set_env_values',
    {
      description:
        'Set env values (fixture — previously missing on AI-SDK runner).',
      inputSchema: {
        filePath: z.string(),
        values: z.record(z.string(), z.string()),
        reason: z.string(),
      },
    },
    () => ({ content: [{ type: 'text' as const, text: 'updated' }] }),
  );

  server.registerTool(
    'confirm_event_plan',
    {
      description:
        'Confirm event plan (fixture — previously missing on AI-SDK runner).',
      inputSchema: { events: z.array(z.string()), reason: z.string() },
    },
    () => ({ content: [{ type: 'text' as const, text: 'ok: plan-id' }] }),
  );

  server.registerTool(
    'wizard_feedback',
    {
      description:
        'Wizard feedback (fixture — previously missing on AI-SDK runner).',
      inputSchema: {
        goal: z.string(),
        steps_tried: z.array(z.string()),
        blocker: z.string(),
        severity: z.enum(['warn', 'error']),
        reason: z.string(),
      },
    },
    () => ({ content: [{ type: 'text' as const, text: 'feedback recorded' }] }),
  );

  return server;
}

describe('bridgeWizardToolsMcp — Phase D-4', () => {
  it('exposes every server-side tool as `mcp__wizard-tools__<name>`', async () => {
    const server = buildFixtureMcpServer();
    const bridge = await bridgeWizardToolsMcp({ instance: server });
    try {
      // The pre-D-4 AI-SDK runner only had `check_env_keys`,
      // `detect_package_manager`, `report_status`, and `write_file` —
      // it silently lost `set_env_values`, `confirm_event_plan`,
      // `wizard_feedback`, etc. The bridge MUST surface those tools or
      // the agent loses critical wizard-managed write paths
      // (env vars, event-plan persistence, blocker telemetry).
      expect(bridge.toolNames).toEqual(
        expect.arrayContaining([
          `mcp__${WIZARD_TOOLS_SERVER_NAME}__check_env_keys`,
          `mcp__${WIZARD_TOOLS_SERVER_NAME}__set_env_values`,
          `mcp__${WIZARD_TOOLS_SERVER_NAME}__confirm_event_plan`,
          `mcp__${WIZARD_TOOLS_SERVER_NAME}__wizard_feedback`,
        ]),
      );
      // Every bridged tool must carry an `execute` so AI-SDK
      // `streamText` can drive it.
      for (const name of bridge.toolNames) {
        expect(bridge.tools[name]).toBeDefined();
        expect(bridge.tools[name]).toHaveProperty('execute');
      }
    } finally {
      await bridge.close();
    }
  });

  it('round-trips a tool call from the AI-SDK execute fn through to the McpServer handler', async () => {
    const server = buildFixtureMcpServer();
    const bridge = await bridgeWizardToolsMcp({ instance: server });
    try {
      const tool = bridge.tools[
        `mcp__${WIZARD_TOOLS_SERVER_NAME}__check_env_keys`
      ] as { execute: (input: unknown, ctx: unknown) => Promise<unknown> };
      const result = await tool.execute(
        {
          filePath: '.env.local',
          keys: ['AMPLITUDE_API_KEY', 'MISSING_VAR'],
          reason: 'verify env contents during agent run',
        },
        {} as unknown,
      );
      const text = typeof result === 'string' ? result : JSON.stringify(result);
      expect(text).toContain('"AMPLITUDE_API_KEY"');
      expect(text).toContain('"present"');
      expect(text).toContain('"MISSING_VAR"');
      expect(text).toContain('"missing"');
    } finally {
      await bridge.close();
    }
  });

  it('passes through bridged tool keys in the canonical `mcp__wizard-tools__*` shape so wizardCanUseTool sees them', async () => {
    // The legacy `wizardCanUseTool` policy in `tool-policy.ts` keys on
    // `mcp__wizard-tools__*` exactly (see e.g. the `load_skill` loop
    // detector at `tool-policy.ts:878`). The bridge must not invent a
    // different key shape — otherwise the policy gate silently bypasses
    // bridged calls.
    const server = buildFixtureMcpServer();
    const bridge = await bridgeWizardToolsMcp({ instance: server });
    try {
      for (const name of bridge.toolNames) {
        expect(name).toMatch(/^mcp__wizard-tools__/);
      }
    } finally {
      await bridge.close();
    }
  });

  it('close() is idempotent and tolerates double-close', async () => {
    const server = buildFixtureMcpServer();
    const bridge = await bridgeWizardToolsMcp({ instance: server });
    await bridge.close();
    await expect(bridge.close()).resolves.not.toThrow();
  });

  it('throws a descriptive error when the supplied server is missing an `instance`', async () => {
    await expect(
      bridgeWizardToolsMcp({ instance: undefined } as unknown as {
        instance: unknown;
      }),
    ).rejects.toThrow(/missing a connectable instance/);
  });

  it('throws when the supplied instance lacks a `connect` method (test-mock shape)', async () => {
    // Defense in depth: the test-only `createSdkMcpServer` mock returns
    // `{ instance: { _registeredTools } }` without a `connect`. The
    // bridge must fail loudly so we don't silently degrade in
    // contexts where the SDK is mocked but the bridge isn't.
    await expect(
      bridgeWizardToolsMcp({
        instance: { _registeredTools: {} } as unknown,
      }),
    ).rejects.toThrow(/missing a connectable instance/);
  });

  it('round-trips arguments through the full AI-SDK streamText pipeline (regression: validate erased input)', async () => {
    // Regression guard for a HIGH-severity Bugbot finding: a previous
    // implementation supplied
    //   `validate: () => ({ success: true, value: undefined })`
    // to `jsonSchema(...)`. Because the AI SDK's `safeValidateTypes`
    // uses `result.value` from a successful validate as the input it
    // hands to `execute(...)`, every bridged tool's `execute` was
    // receiving `undefined`, falling into the `input == null ? {} :
    // input` branch, and calling `client.callTool({ arguments: {} })`
    // — silently dropping every argument the model produced.
    //
    // The earlier "round-trips a tool call from the AI-SDK execute fn
    // through to the McpServer handler" test missed the bug because it
    // calls `tool.execute(args, ctx)` directly, bypassing the SDK's
    // schema-validation pipeline.
    //
    // This test wires a real `streamText` run against `MockLanguageModelV3`
    // and the actual bridged tool surface. The mock model emits a single
    // `tool-call` part with a JSON-serialized `input`; the SDK's
    // tool-execution machinery parses that input, runs validation, and
    // calls our bridged `execute` — which routes to a fixture
    // McpServer handler that captures the arguments it actually
    // received. We then assert those arguments match the original
    // model-emitted payload character-for-character.
    let capturedArgs: unknown = 'NEVER_CALLED';
    const server = new McpServer({
      name: WIZARD_TOOLS_SERVER_NAME,
      version: '1.0.0',
    });
    server.registerTool(
      'set_env_values',
      {
        description: 'Set env values (fixture).',
        inputSchema: {
          filePath: z.string(),
          values: z.record(z.string(), z.string()),
          reason: z.string(),
        },
      },
      (args) => {
        capturedArgs = args;
        return { content: [{ type: 'text' as const, text: 'updated' }] };
      },
    );

    const bridge = await bridgeWizardToolsMcp({ instance: server });
    try {
      const expectedInput = {
        filePath: '.env.local',
        values: { AMPLITUDE_API_KEY: 'abc123' },
        reason: 'pin arg round-trip through AI-SDK',
      };
      const toolName = `mcp__${WIZARD_TOOLS_SERVER_NAME}__set_env_values`;
      // Mock model emits a tool-call referencing the bridged tool with a
      // JSON-encoded `input` payload — same wire shape an Anthropic
      // gateway response would carry.
      const model = new MockLanguageModelV3({
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              {
                type: 'tool-input-start',
                id: 'c1',
                toolName,
              },
              {
                type: 'tool-input-delta',
                id: 'c1',
                delta: JSON.stringify(expectedInput),
              },
              { type: 'tool-input-end', id: 'c1' },
              {
                type: 'tool-call',
                toolCallId: 'c1',
                toolName,
                input: JSON.stringify(expectedInput),
              },
              {
                type: 'finish',
                finishReason: { unified: 'tool-calls', raw: 'tool_use' },
                usage: { inputTokens: 1, outputTokens: 1 },
              },
            ] as never[],
            chunkDelayInMs: 0,
            initialDelayInMs: 0,
          }),
        }),
      });

      const result = streamText({
        model,
        prompt: 'set env',
        tools: bridge.tools,
        // Single step — we only care about the first tool call's input.
        stopWhen: stepCountIs(1),
        maxRetries: 0,
      });
      // Drain the stream so tool execution actually fires.
      for await (const _part of result.fullStream) {
        void _part;
      }
      await result.finishReason;

      // Core assertion: the McpServer handler received the exact input
      // the model emitted — not `{}` (which is what the bug produced)
      // and not `undefined`. If the bridge ever regresses to a
      // `validate` that returns `{ value: undefined }`, this expect
      // line breaks deterministically with `capturedArgs === {}`.
      expect(capturedArgs).toEqual(expectedInput);
    } finally {
      await bridge.close();
    }
  });
});
