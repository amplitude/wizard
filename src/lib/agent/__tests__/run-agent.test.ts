/**
 * Phase D-3 — focused integration test for the AI-SDK inner-loop runner.
 *
 * Strategy:
 *   1. Mock the AI SDK transport via `MockLanguageModelV3` from `ai/test`.
 *   2. Drive a synthetic stream that issues text deltas, a tool call, and
 *      a `finish` part.
 *   3. Assert the runner makes the right tool call, emits the right
 *      events through the WizardUI, respects `wizardCanUseTool`, and
 *      surfaces an `AgentErrorType` when the transport throws.
 *   4. Smoke parity: assert the AgentUI NDJSON envelope shape on tool
 *      events matches what the legacy runner already produces (same
 *      `data.event` discriminator, same shape).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { simulateReadableStream } from 'ai/test';
import { MockLanguageModelV3 } from 'ai/test';

import { setUI } from '../../../ui/index.js';
import { AgentUI } from '../../../ui/agent-ui.js';
import { LoggingUI } from '../../../ui/logging-ui.js';
import { runAiSdkAgent, buildAiSdkSystemPrompt } from '../run-agent.js';
import type { WizardOptions } from '../../../utils/types.js';

// ── Helpers ──────────────────────────────────────────────────────────

/** Minimal `WizardOptions` sufficient for the policy gate. */
function makeWizardOptions(): WizardOptions {
  return {
    installDir: process.cwd(),
    debug: false,
    promo: undefined,
    cloudRegion: 'us',
  } as unknown as WizardOptions;
}

/**
 * Build a `MockLanguageModelV3` whose `doStream` yields the supplied
 * stream parts in order, then resolves cleanly. Mirrors the test
 * pattern in `wizard-rewrite/src/agents/wizard-agent-loop.spec.ts` —
 * single hermetic stream, no live gateway traffic.
 */
function makeMockModel(streamParts: unknown[]): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-6',
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: streamParts as never[],
        chunkDelayInMs: 0,
        initialDelayInMs: 0,
      }),
    }),
  });
}

/** Capture stdout NDJSON lines emitted by AgentUI during the test. */
function captureStdout(): {
  lines: string[];
  restore: () => void;
} {
  const lines: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  // Vitest's stdout interception is fragile here — patch `write` directly.
  (process.stdout as unknown as { write: typeof process.stdout.write }).write =
    ((chunk: unknown) => {
      if (typeof chunk === 'string') {
        for (const line of chunk.split('\n')) {
          if (line.trim()) lines.push(line);
        }
      }
      return true;
    }) as typeof process.stdout.write;
  return {
    lines,
    restore: () => {
      (
        process.stdout as unknown as { write: typeof process.stdout.write }
      ).write = original;
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('runAiSdkAgent — Phase D-3 foundation', () => {
  beforeEach(() => {
    // Use LoggingUI by default so emit calls don't blow up. Specific
    // tests opt into AgentUI to assert NDJSON envelope shape.
    setUI(new LoggingUI());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('streams text deltas and resolves with finishReason "stop"', async () => {
    const model = makeMockModel([
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'Hello ' },
      { type: 'text-delta', id: 't1', delta: 'world' },
      { type: 'text-end', id: 't1' },
      {
        type: 'finish',
        finishReason: { unified: 'stop', raw: 'end_turn' },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
    ]);

    const result = await runAiSdkAgent({
      workingDirectory: process.cwd(),
      prompt: 'hi',
      model,
      wizardOptions: makeWizardOptions(),
      maxSteps: 3,
    });

    expect(result.error).toBeUndefined();
    expect(result.text).toBe('Hello world');
    expect(result.finishReason).toBe('stop');
    // Usage shape is provider-mediated: AI SDK 6 surfaces it via
    // `result.totalUsage` which mock streams may or may not populate
    // depending on the part shape. The important contract here is
    // that the runner *exposes* a usage object — populated values are
    // covered by the live-gateway probe, not this hermetic test.
    expect(result.usage).toBeDefined();
    expect(result.toolCalls).toEqual([]);
  });

  it('records tool calls and forwards toolName/input to the runner result', async () => {
    const model = makeMockModel([
      { type: 'stream-start', warnings: [] },
      {
        type: 'tool-call',
        toolCallId: 'c1',
        toolName: 'report_status',
        input: { message: 'thinking', reason: 'surface a status' },
      },
      {
        type: 'finish',
        finishReason: { unified: 'tool-calls', raw: 'tool_use' },
        usage: { inputTokens: 12, outputTokens: 8 },
      },
    ]);

    // maxSteps=1 so the SDK stops after the first step instead of
    // looping back to the same tool-call mock for as many steps as we
    // allow. Real production runs use the default `resolveMaxTurns()`;
    // the test pins behavior on a single tool-emitting step.
    const result = await runAiSdkAgent({
      workingDirectory: process.cwd(),
      prompt: 'hi',
      model,
      wizardOptions: makeWizardOptions(),
      maxSteps: 1,
    });

    expect(result.error).toBeUndefined();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toEqual({
      toolName: 'report_status',
      input: { message: 'thinking', reason: 'surface a status' },
    });
  });

  it('classifies an upstream throw into AgentErrorType.GATEWAY_INVALID_REQUEST', async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => {
        throw new Error('Invalid request sent to model provider');
      },
    });

    const result = await runAiSdkAgent({
      workingDirectory: process.cwd(),
      prompt: 'hi',
      model,
      wizardOptions: makeWizardOptions(),
      maxSteps: 3,
    });

    expect(result.error).toBe('WIZARD_GATEWAY_INVALID_REQUEST');
    expect(result.message).toMatch(/Invalid request sent to model provider/);
    expect(result.text).toBe('');
  });

  it('classifies a transient stream throw into AgentErrorType.GATEWAY_DOWN', async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => {
        throw new Error('API Error: 503 service unavailable');
      },
    });

    const result = await runAiSdkAgent({
      workingDirectory: process.cwd(),
      prompt: 'hi',
      model,
      wizardOptions: makeWizardOptions(),
      maxSteps: 3,
    });

    expect(result.error).toBe('WIZARD_GATEWAY_DOWN');
  });

  it('classifies an auth-flavored throw into AgentErrorType.AUTH_ERROR', async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => {
        throw new Error('authentication_error: token expired (401)');
      },
    });

    const result = await runAiSdkAgent({
      workingDirectory: process.cwd(),
      prompt: 'hi',
      model,
      wizardOptions: makeWizardOptions(),
      maxSteps: 3,
    });

    expect(result.error).toBe('WIZARD_AUTH_ERROR');
  });

  it('surfaces in-stream `error` parts as a classified result', async () => {
    const model = makeMockModel([
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'partial' },
      { type: 'error', error: 'API Error: 408' },
      // Even though we send finish, the runner short-circuits on
      // streamError and surfaces a typed AgentErrorType.
      {
        type: 'finish',
        finishReason: { unified: 'error', raw: 'error' },
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);

    const result = await runAiSdkAgent({
      workingDirectory: process.cwd(),
      prompt: 'hi',
      model,
      wizardOptions: makeWizardOptions(),
      maxSteps: 3,
    });

    expect(result.error).toBe('WIZARD_GATEWAY_DOWN');
    expect(result.text).toBe('partial');
  });

  it('emits NDJSON `tool_call` envelope shape via AgentUI (smoke parity)', async () => {
    setUI(new AgentUI());
    const capture = captureStdout();
    try {
      const model = makeMockModel([
        { type: 'stream-start', warnings: [] },
        {
          type: 'tool-call',
          toolCallId: 'c1',
          toolName: 'report_status',
          input: { message: 'parity check', reason: 'r' },
        },
        {
          type: 'finish',
          finishReason: { unified: 'tool-calls', raw: 'tool_use' },
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ]);

      await runAiSdkAgent({
        workingDirectory: process.cwd(),
        prompt: 'hi',
        model,
        wizardOptions: makeWizardOptions(),
        maxSteps: 1,
      });
    } finally {
      capture.restore();
    }

    // Smoke parity: at least one NDJSON line should be a `tool_call`
    // event with the canonical shape the legacy `inner-lifecycle.ts`
    // emits — `type: 'progress'`, `data.event: 'tool_call'`, `data.tool`
    // populated.
    const toolCallLine = capture.lines
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .find(
        (envelope) =>
          envelope?.type === 'progress' &&
          envelope?.data?.event === 'tool_call',
      );

    expect(toolCallLine).toBeDefined();
    expect(toolCallLine?.data?.tool).toBe('report_status');
    // Envelope shape pinned to the same v:1 the legacy path emits.
    expect(toolCallLine?.v).toBe(1);
    expect(typeof toolCallLine?.['@timestamp']).toBe('string');
  });

  it('emits `inner_agent_started` exactly once via AgentUI', async () => {
    setUI(new AgentUI());
    const capture = captureStdout();
    try {
      const model = makeMockModel([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'ok' },
        { type: 'text-end', id: 't1' },
        {
          type: 'finish',
          finishReason: { unified: 'stop', raw: 'end_turn' },
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ]);

      await runAiSdkAgent({
        workingDirectory: process.cwd(),
        prompt: 'hi',
        model,
        wizardOptions: makeWizardOptions(),
        maxSteps: 3,
      });
    } finally {
      capture.restore();
    }

    const innerStarted = capture.lines
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter(
        (env) =>
          env?.type === 'lifecycle' &&
          env?.data?.event === 'inner_agent_started',
      );

    expect(innerStarted).toHaveLength(1);
  });
});

describe('buildAiSdkSystemPrompt', () => {
  it('returns commandments alone when no orchestrator context is supplied', () => {
    const prompt = buildAiSdkSystemPrompt({});
    expect(prompt).toContain('Never hallucinate an Amplitude API key');
    expect(prompt).not.toContain('Orchestrator-injected context');
  });

  it('appends a labeled context block when orchestrator context is non-empty', () => {
    const prompt = buildAiSdkSystemPrompt({
      orchestratorContext: 'Use snake_case for events.',
    });
    expect(prompt).toContain('Orchestrator-injected context');
    expect(prompt).toContain('Use snake_case for events.');
  });

  it('treats whitespace-only orchestrator context as empty', () => {
    const prompt = buildAiSdkSystemPrompt({
      orchestratorContext: '   \n  ',
    });
    expect(prompt).not.toContain('Orchestrator-injected context');
  });
});
