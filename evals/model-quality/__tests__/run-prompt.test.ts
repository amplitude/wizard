/**
 * Unit test for the per-prompt runner in
 * `evals/model-quality/lib/run-prompt.mjs`.
 *
 * Mocks the `streamText` + `createAnthropic` deps so we never hit the
 * network. Asserts that:
 *   - the right model alias is selected for `haiku` vs `sonnet`,
 *   - the gateway prefix is applied when an authToken is used,
 *   - the bare alias is sent on the direct-API path,
 *   - latency + token usage are surfaced on the row,
 *   - errors are captured instead of thrown.
 */
import { describe, it, expect } from 'vitest';

// @ts-expect-error — .mjs import path; vitest resolves via Node ESM loader.
import { runPrompt } from '../lib/run-prompt.mjs';
// @ts-expect-error — .mjs import path; vitest resolves via Node ESM loader.
import { MODEL_ALIASES } from '../lib/scorers.mjs';

type Capture = {
  modelArg: unknown;
  createAnthropicOpts: unknown;
};

function makeDeps(opts: {
  capture: Capture;
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  throwOn?: 'createAnthropic' | 'streamText';
}) {
  const provider = (modelStr: string) => ({ __isModel: true, modelStr });
  const createAnthropic = (createOpts: unknown) => {
    if (opts.throwOn === 'createAnthropic') throw new Error('boom');
    opts.capture.createAnthropicOpts = createOpts;
    return provider;
  };
  const streamText = (req: { model: { modelStr: string } }) => {
    if (opts.throwOn === 'streamText') throw new Error('streamText boom');
    opts.capture.modelArg = req.model.modelStr;
    return {
      textStream: (async function* () {
        // Two chunks so the runner sees a TTFT (first chunk arrives,
        // then the rest).
        yield opts.text.slice(0, 1);
        yield opts.text.slice(1);
      })(),
      usage: Promise.resolve(opts.usage ?? {}),
    };
  };
  return { streamText, createAnthropic };
}

describe('runPrompt', () => {
  it('selects the Haiku alias and applies anthropic/ prefix on gateway path', async () => {
    const capture: Capture = { modelArg: null, createAnthropicOpts: null };
    const deps = makeDeps({ capture, text: 'hi' });

    const row = await runPrompt({
      modelRole: 'haiku',
      userMessage: 'hello',
      auth: {
        baseURL: 'https://core.amplitude.com/wizard',
        authToken: 'tok',
      },
      deps,
    });

    expect(row.modelRole).toBe('haiku');
    expect(row.modelAlias).toBe(MODEL_ALIASES.haiku);
    expect(row.gatewayModel).toBe(`anthropic/${MODEL_ALIASES.haiku}`);
    expect(capture.modelArg).toBe(`anthropic/${MODEL_ALIASES.haiku}`);
    expect(capture.createAnthropicOpts).toMatchObject({
      baseURL: 'https://core.amplitude.com/wizard',
      authToken: 'tok',
    });
    expect(row.text).toBe('hi');
    expect(row.error).toBeNull();
  });

  it('selects the Sonnet alias on gateway path', async () => {
    const capture: Capture = { modelArg: null, createAnthropicOpts: null };
    const deps = makeDeps({ capture, text: 'sonnet ok' });

    const row = await runPrompt({
      modelRole: 'sonnet',
      userMessage: 'hello',
      auth: {
        baseURL: 'https://core.amplitude.com/wizard',
        authToken: 'tok',
      },
      deps,
    });

    expect(row.modelAlias).toBe(MODEL_ALIASES.sonnet);
    expect(row.gatewayModel).toBe(`anthropic/${MODEL_ALIASES.sonnet}`);
    expect(capture.modelArg).toBe(`anthropic/${MODEL_ALIASES.sonnet}`);
  });

  it('uses the bare alias on direct-API path (apiKey, no baseURL)', async () => {
    const capture: Capture = { modelArg: null, createAnthropicOpts: null };
    const deps = makeDeps({ capture, text: 'ok' });

    const row = await runPrompt({
      modelRole: 'haiku',
      userMessage: 'hello',
      auth: { apiKey: 'sk-test' },
      deps,
    });

    expect(row.gatewayModel).toBe(MODEL_ALIASES.haiku);
    expect(capture.modelArg).toBe(MODEL_ALIASES.haiku);
    expect(capture.createAnthropicOpts).toMatchObject({ apiKey: 'sk-test' });
  });

  it('surfaces token usage on the row', async () => {
    const capture: Capture = { modelArg: null, createAnthropicOpts: null };
    const deps = makeDeps({
      capture,
      text: 'hello world',
      usage: { inputTokens: 12, outputTokens: 7 },
    });

    const row = await runPrompt({
      modelRole: 'haiku',
      userMessage: 'hi',
      auth: { authToken: 't', baseURL: 'http://x' },
      deps,
    });

    expect(row.inputTokens).toBe(12);
    expect(row.outputTokens).toBe(7);
    expect(row.totalMs).toBeGreaterThanOrEqual(0);
    // ttftMs should be set after the first chunk arrives.
    expect(row.ttftMs).not.toBeNull();
    expect((row.ttftMs as number) <= row.totalMs).toBe(true);
  });

  it('captures errors instead of throwing', async () => {
    const capture: Capture = { modelArg: null, createAnthropicOpts: null };
    const deps = makeDeps({ capture, text: '', throwOn: 'streamText' });

    const row = await runPrompt({
      modelRole: 'haiku',
      userMessage: 'hi',
      auth: { authToken: 't', baseURL: 'http://x' },
      deps,
    });

    expect(row.error).toMatch(/streamText boom/);
    expect(row.text).toBe('');
  });

  it('forwards system + maxOutputTokens when provided', async () => {
    const capture: Capture & { req?: any } = {
      modelArg: null,
      createAnthropicOpts: null,
    };
    const provider = (modelStr: string) => ({ __isModel: true, modelStr });
    const createAnthropic = () => provider;
    const streamText = (req: any) => {
      capture.req = req;
      return {
        textStream: (async function* () {
          yield 'ok';
        })(),
        usage: Promise.resolve({}),
      };
    };

    const row = await runPrompt({
      modelRole: 'haiku',
      userMessage: 'hi',
      system: 'you are a helpful assistant',
      maxOutputTokens: 32,
      auth: { authToken: 't', baseURL: 'http://x' },
      deps: { streamText, createAnthropic },
    });

    expect(row.error).toBeNull();
    expect(capture.req.system).toBe('you are a helpful assistant');
    expect(capture.req.maxOutputTokens).toBe(32);
  });
});
