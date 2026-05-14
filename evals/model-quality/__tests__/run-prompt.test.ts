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
import {
  runPrompt,
  authToRunnerShape,
  ensureV1Suffix,
  resolveHarnessAuth,
} from '../lib/run-prompt.mjs';
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
    expect(row.usageError).toBeNull();
  });

  it('records usage-read failures as usageError without setting error', async () => {
    // Stream text succeeds; the `usage` promise rejects (provider quirk
    // / transient token-counting failure). The text is valid model
    // output and MUST be kept — the only loss is token counts. The
    // runner records the failure on `row.usageError` (warning channel)
    // and leaves `row.error` null, so downstream scoring keeps the
    // sample.
    const provider = (modelStr: string) => ({ __isModel: true, modelStr });
    const createAnthropic = () => provider;
    const streamText = () => ({
      textStream: (async function* () {
        yield 'hello ';
        yield 'world';
      })(),
      usage: Promise.reject(new Error('upstream usage 500')),
    });

    const row = await runPrompt({
      modelRole: 'haiku',
      userMessage: 'hi',
      auth: { authToken: 't', baseURL: 'http://x' },
      deps: { streamText, createAnthropic },
    });

    expect(row.text).toBe('hello world');
    expect(row.error).toBeNull();
    expect(row.usageError).toMatch(/upstream usage 500/);
    expect(row.inputTokens).toBeNull();
    expect(row.outputTokens).toBeNull();
  });

  it('authToRunnerShape: oauth → baseURL + authToken', () => {
    expect(
      authToRunnerShape({
        kind: 'oauth',
        baseURL: 'http://gw',
        authToken: 'tok',
      }),
    ).toEqual({ baseURL: 'http://gw', authToken: 'tok' });
  });

  it('authToRunnerShape: api-key with baseURL → both fields', () => {
    expect(
      authToRunnerShape({
        kind: 'api-key',
        baseURL: 'http://x',
        apiKey: 'sk',
      }),
    ).toEqual({ baseURL: 'http://x', apiKey: 'sk' });
  });

  it('authToRunnerShape: api-key without baseURL → apiKey only', () => {
    expect(authToRunnerShape({ kind: 'api-key', apiKey: 'sk' })).toEqual({
      apiKey: 'sk',
    });
  });

  it('authToRunnerShape: null / unknown → empty object', () => {
    expect(authToRunnerShape(null)).toEqual({});
    expect(authToRunnerShape(undefined)).toEqual({});
    expect(authToRunnerShape({ kind: 'mystery' })).toEqual({});
  });

  describe('ensureV1Suffix', () => {
    it('appends /v1 when missing', () => {
      expect(ensureV1Suffix('https://core.amplitude.com/wizard')).toBe(
        'https://core.amplitude.com/wizard/v1',
      );
    });

    it('strips trailing slash before appending', () => {
      expect(ensureV1Suffix('https://core.amplitude.com/wizard/')).toBe(
        'https://core.amplitude.com/wizard/v1',
      );
    });

    it('is idempotent when /v1 already present', () => {
      expect(ensureV1Suffix('https://core.amplitude.com/wizard/v1')).toBe(
        'https://core.amplitude.com/wizard/v1',
      );
    });

    it('leaves any /vN suffix alone (no double-suffixing)', () => {
      expect(ensureV1Suffix('https://api.anthropic.com/v2')).toBe(
        'https://api.anthropic.com/v2',
      );
    });

    it('passes through falsy values unchanged', () => {
      expect(ensureV1Suffix('')).toBe('');
      expect(ensureV1Suffix(undefined as unknown as string)).toBeUndefined();
    });
  });

  describe('resolveHarnessAuth gateway baseURL', () => {
    const ENV_KEYS = [
      'WIZARD_OAUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'WIZARD_LLM_PROXY_URL',
      'ANTHROPIC_API_KEY',
    ];
    const saved: Record<string, string | undefined> = {};

    function snapshotEnv() {
      for (const k of ENV_KEYS) saved[k] = process.env[k];
    }
    function restoreEnv() {
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }

    it('appends /v1 to default gateway URL on OAuth path', () => {
      snapshotEnv();
      try {
        for (const k of ENV_KEYS) delete process.env[k];
        process.env.WIZARD_OAUTH_TOKEN = 'tok';
        const auth = resolveHarnessAuth();
        expect(auth).toEqual({
          kind: 'oauth',
          baseURL: 'https://core.amplitude.com/wizard/v1',
          authToken: 'tok',
        });
      } finally {
        restoreEnv();
      }
    });

    it('respects an operator-supplied /v1 URL without double-suffixing', () => {
      snapshotEnv();
      try {
        for (const k of ENV_KEYS) delete process.env[k];
        process.env.WIZARD_OAUTH_TOKEN = 'tok';
        process.env.ANTHROPIC_BASE_URL = 'https://my-proxy.example/wizard/v1';
        const auth = resolveHarnessAuth();
        expect(auth).toEqual({
          kind: 'oauth',
          baseURL: 'https://my-proxy.example/wizard/v1',
          authToken: 'tok',
        });
      } finally {
        restoreEnv();
      }
    });
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
