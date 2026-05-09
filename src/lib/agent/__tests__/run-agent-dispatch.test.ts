/**
 * Phase D-3 — coverage for the AI-SDK dispatch shim.
 *
 * These tests pin the three Bugbot fixes called out on PR #596:
 *
 *   1. (HIGH) System message format — covered in `run-agent.test.ts`
 *      via `buildAiSdkSystemPrompt` + the new `systemMessageWithCacheControl`
 *      shape pinned against AI SDK v6's `SystemModelMessage` schema.
 *   2. (MEDIUM) Session-id header — `buildAiSdkProviderHeaders` must include
 *      `x-amp-wizard-session-id` so Agent Analytics correlates `/v1/messages`
 *      calls into a single session.
 *   3. (LOW) Observability middleware — the AI-SDK branch must call
 *      `middleware.onMessage(system:init)` and `middleware.finalize(result)`
 *      so the always-on observability pipeline keeps emitting structured
 *      logs / Sentry breadcrumbs / NDJSON `agent_metrics` envelopes.
 */
import { describe, expect, it, vi } from 'vitest';

import { systemModelMessageSchema, userModelMessageSchema } from 'ai';

import {
  systemMessageWithCacheControl,
  userMessageWithCacheControl,
} from '../run-agent.js';
import {
  buildAiSdkProviderHeaders,
  type RunAgentDispatchMiddleware,
} from '../run-agent-dispatch.js';
import {
  WIZARD_SESSION_ID_HEADER,
  buildAgentEnv,
} from '../../agent-interface.js';

describe('systemMessageWithCacheControl', () => {
  it('produces a value that validates as a SystemModelMessage (AI SDK v6 schema)', () => {
    // Pinning against the SDK's exported zod schema is the definitive
    // check: if a future AI SDK rev tightens the shape, this test
    // breaks deterministically with the schema's error message — we
    // never get a silent mismatch the way Bugbot warned about.
    const msg = systemMessageWithCacheControl('hello commandments');
    const parsed = systemModelMessageSchema.safeParse(msg);
    expect(parsed.success).toBe(true);
  });

  it('attaches the Anthropic `cacheControl: ephemeral` provider option', () => {
    const msg = systemMessageWithCacheControl('static prefix');
    expect(msg.role).toBe('system');
    expect(msg.content).toBe('static prefix');
    expect(msg.providerOptions).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral' } },
    });
  });
});

describe('userMessageWithCacheControl', () => {
  it('produces a value that validates as a UserModelMessage (AI SDK v6 schema)', () => {
    const msg = userMessageWithCacheControl('integration prompt body');
    const parsed = userModelMessageSchema.safeParse(msg);
    expect(parsed.success).toBe(true);
  });

  it('attaches the Anthropic `cacheControl: ephemeral` provider option', () => {
    const msg = userMessageWithCacheControl('user prefix');
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('user prefix');
    expect(msg.providerOptions).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral' } },
    });
  });
});

describe('buildAiSdkProviderHeaders — session-id propagation', () => {
  it('includes the wizard-session-id header when agentSessionId is set', () => {
    const headers = buildAiSdkProviderHeaders({
      wizardMetadata: {},
      wizardFlags: {},
      agentSessionId: 'session-abc-123',
      buildAgentEnvImpl: buildAgentEnv,
    });
    expect(headers[WIZARD_SESSION_ID_HEADER]).toBe('session-abc-123');
  });

  it('omits the wizard-session-id header when agentSessionId is undefined', () => {
    const headers = buildAiSdkProviderHeaders({
      wizardMetadata: {},
      wizardFlags: {},
      buildAgentEnvImpl: buildAgentEnv,
    });
    expect(headers[WIZARD_SESSION_ID_HEADER]).toBeUndefined();
  });

  it('forwards wizard metadata and feature flags as Amplitude headers', () => {
    const headers = buildAiSdkProviderHeaders({
      wizardMetadata: { variant: 'base' },
      wizardFlags: { 'wizard-experiment': 'control' },
      agentSessionId: 'sid',
      buildAgentEnvImpl: buildAgentEnv,
    });
    // Property header prefix is `X-AMPLITUDE-PROPERTY-` (constants.ts).
    // The key suffix preserves the metadata key casing as-is.
    expect(headers['X-AMPLITUDE-PROPERTY-variant']).toBe('base');
    // Flag header prefix is `X-AMPLITUDE-FLAG-` (constants.ts) and
    // upper-cases the flag key (`addFlag` in custom-headers.ts).
    expect(headers['X-AMPLITUDE-FLAG-WIZARD-EXPERIMENT']).toBe('control');
    expect(headers[WIZARD_SESSION_ID_HEADER]).toBe('sid');
  });

  it('uses the injected buildAgentEnv impl (testability seam)', () => {
    const stub = vi.fn().mockReturnValue('X-Test: 1\nX-Other: 2');
    const headers = buildAiSdkProviderHeaders({
      wizardMetadata: { foo: 'bar' },
      wizardFlags: { wizard: 'on' },
      agentSessionId: 'id',
      buildAgentEnvImpl: stub,
    });
    expect(stub).toHaveBeenCalledWith({ foo: 'bar' }, { wizard: 'on' }, 'id');
    expect(headers).toEqual({ 'X-Test': '1', 'X-Other': '2' });
  });
});

describe('runAgentDispatch — observability middleware bridge (AI-SDK path)', () => {
  // We don't drive the AI-SDK branch end-to-end here — the runner has
  // its own coverage in `run-agent.test.ts`. Instead, the dispatch
  // contract we care about is: when the AI-SDK branch is selected,
  // the supplied middleware sees BOTH `onMessage(system:init)` AND
  // `finalize(result-shaped, durationMs)`. The runner is mocked to a
  // resolved success so the test stays hermetic and fast.
  //
  // The harness uses `vi.doMock` + dynamic import to make sure the
  // dispatch module re-evaluates with the mocked runner. The flag
  // module is also mocked so we stay on the AI-SDK branch without
  // touching `process.env`.

  it('emits middleware.onMessage(system:init) and middleware.finalize on success', async () => {
    vi.resetModules();

    vi.doMock('../run-agent-feature-flag.js', () => ({
      AI_SDK_INNER_LOOP_ENV_VAR: 'AMPLITUDE_WIZARD_AI_SDK_INNER_LOOP',
      isAiSdkInnerLoopEnabled: () => true,
    }));
    vi.doMock('../run-agent.js', () => ({
      runAiSdkAgent: vi.fn().mockResolvedValue({
        text: 'ok',
        finishReason: 'stop',
        toolCalls: [],
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 15,
        },
      }),
    }));
    vi.doMock('../wizard-ai-sdk-anthropic.js', () => ({
      createWizardAiSdkAnthropic: vi.fn().mockReturnValue(
        // Mocked provider: returns a placeholder LanguageModel object
        // — the real one is exercised in the gateway probe + run-agent
        // tests.
        () => ({ specificationVersion: 'v3', modelId: 'fake' }),
      ),
    }));

    const { runAgentDispatch } = await import('../run-agent-dispatch.js');

    const onMessage = vi.fn();
    const finalize = vi.fn();
    const middleware: RunAgentDispatchMiddleware = { onMessage, finalize };

    const spinner = {
      start: vi.fn(),
      stop: vi.fn(),
      fail: vi.fn(),
      isActive: () => false,
    } as unknown as Parameters<typeof runAgentDispatch>[3];

    await runAgentDispatch(
      {
        workingDirectory: process.cwd(),
        mcpServers: {} as never,
        model: 'anthropic/claude-sonnet-4-6',
        agentSessionId: 'session-xyz',
        wizardMetadata: { variant: 'base' },
        wizardFlags: { wizard: 'on' },
      },
      'prompt',
      { installDir: process.cwd(), debug: false } as never,
      spinner,
      undefined,
      middleware,
    );

    // onMessage fires once at run-start with system:init (synthetic
    // shape so the always-on observability middleware sees a stable
    // lifecycle signal).
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0]?.[0]).toEqual({
      type: 'system',
      subtype: 'init',
    });

    // finalize fires once with a `result`-shaped SDKMessage carrying
    // usage so observability's `emitAgentMetrics` lands.
    expect(finalize).toHaveBeenCalledTimes(1);
    const [resultMessage, durationMs] = finalize.mock.calls[0] ?? [];
    expect(resultMessage).toMatchObject({
      type: 'result',
      is_error: false,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
      },
    });
    expect(typeof durationMs).toBe('number');
    expect(durationMs).toBeGreaterThanOrEqual(0);

    vi.doUnmock('../run-agent-feature-flag.js');
    vi.doUnmock('../run-agent.js');
    vi.doUnmock('../wizard-ai-sdk-anthropic.js');
  });

  it('emits middleware.finalize with is_error=true when the runner returns an error result', async () => {
    vi.resetModules();

    vi.doMock('../run-agent-feature-flag.js', () => ({
      AI_SDK_INNER_LOOP_ENV_VAR: 'AMPLITUDE_WIZARD_AI_SDK_INNER_LOOP',
      isAiSdkInnerLoopEnabled: () => true,
    }));
    vi.doMock('../run-agent.js', () => ({
      runAiSdkAgent: vi.fn().mockResolvedValue({
        error: 'WIZARD_GATEWAY_DOWN',
        message: 'service unavailable',
        text: '',
        finishReason: 'error',
        toolCalls: [],
        usage: {
          inputTokens: undefined,
          outputTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
          totalTokens: undefined,
        },
      }),
    }));
    vi.doMock('../wizard-ai-sdk-anthropic.js', () => ({
      createWizardAiSdkAnthropic: vi.fn().mockReturnValue(() => ({
        specificationVersion: 'v3',
        modelId: 'fake',
      })),
    }));

    const { runAgentDispatch } = await import('../run-agent-dispatch.js');

    const onMessage = vi.fn();
    const finalize = vi.fn();
    const middleware: RunAgentDispatchMiddleware = { onMessage, finalize };

    const spinner = {
      start: vi.fn(),
      stop: vi.fn(),
      fail: vi.fn(),
      isActive: () => false,
    } as unknown as Parameters<typeof runAgentDispatch>[3];

    const result = await runAgentDispatch(
      {
        workingDirectory: process.cwd(),
        mcpServers: {} as never,
        model: 'anthropic/claude-sonnet-4-6',
      },
      'prompt',
      { installDir: process.cwd(), debug: false } as never,
      spinner,
      undefined,
      middleware,
    );

    expect(result.error).toBe('WIZARD_GATEWAY_DOWN');
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(finalize.mock.calls[0]?.[0]).toMatchObject({
      type: 'result',
      is_error: true,
      result: 'service unavailable',
    });

    vi.doUnmock('../run-agent-feature-flag.js');
    vi.doUnmock('../run-agent.js');
    vi.doUnmock('../wizard-ai-sdk-anthropic.js');
  });
});
