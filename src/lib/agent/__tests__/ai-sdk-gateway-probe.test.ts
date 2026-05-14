import { afterEach, describe, expect, it, vi } from 'vitest';

describe('maybeRunAiSdkGatewayProbe', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('skips when AMPLITUDE_WIZARD_AI_SDK_PROBE is unset', async () => {
    vi.stubEnv('AMPLITUDE_WIZARD_AI_SDK_PROBE', undefined);
    const { maybeRunAiSdkGatewayProbe } = await import(
      '../ai-sdk-gateway-probe.js'
    );
    const r = await maybeRunAiSdkGatewayProbe({
      useLocalClaude: false,
      useDirectApiKey: false,
    });
    expect(r.status).toBe('skipped');
  });

  it('skips for local Claude path', async () => {
    vi.stubEnv('AMPLITUDE_WIZARD_AI_SDK_PROBE', '1');
    const { maybeRunAiSdkGatewayProbe } = await import(
      '../ai-sdk-gateway-probe.js'
    );
    const r = await maybeRunAiSdkGatewayProbe({
      useLocalClaude: true,
      useDirectApiKey: false,
    });
    expect(r.status).toBe('skipped');
    if (r.status === 'skipped') {
      expect(r.reason).toContain('local Claude');
    }
  });

  it('passes a /v1-suffixed baseURL to createWizardAiSdkAnthropic so the AI SDK posts to …/wizard/v1/messages instead of 404ing on …/wizard/messages', async () => {
    vi.stubEnv('AMPLITUDE_WIZARD_AI_SDK_PROBE', '1');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://core.amplitude.com/wizard');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'oauth-token-xyz');
    vi.stubEnv('ANTHROPIC_API_KEY', '');

    // Stub the AI SDK + factory dynamic imports so the probe never hits a
    // real network endpoint. We only care about the `baseURL` argument the
    // probe forwards to the factory.
    const mockCreateWizardAiSdkAnthropic = vi.fn(() => () => 'fake-model');
    const mockStreamText = vi.fn(() => ({
      textStream: (async function* () {
        yield 'wizard_ai_sdk_probe_ok';
      })(),
    }));

    vi.doMock('../wizard-ai-sdk-anthropic.js', () => ({
      createWizardAiSdkAnthropic: mockCreateWizardAiSdkAnthropic,
      // Use the real ensureV1Suffix logic — the probe imports both names
      // from the same module, and we want to assert the helper actually
      // does the work, not just that the probe forwards a hardcoded value.
      ensureV1Suffix: (raw: string | undefined) => {
        if (!raw) return raw;
        const trimmed = raw.replace(/\/+$/, '');
        return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
      },
    }));
    vi.doMock('ai', () => ({ streamText: mockStreamText }));

    const { maybeRunAiSdkGatewayProbe } = await import(
      '../ai-sdk-gateway-probe.js'
    );

    const r = await maybeRunAiSdkGatewayProbe({
      useLocalClaude: false,
      useDirectApiKey: false,
    });

    expect(r.status).toBe('ok');
    expect(mockCreateWizardAiSdkAnthropic).toHaveBeenCalledTimes(1);
    const factoryArgs = mockCreateWizardAiSdkAnthropic.mock.calls[0][0] as {
      baseURL?: string;
    };
    expect(factoryArgs.baseURL).toBe('https://core.amplitude.com/wizard/v1');
  });
});

describe('maybeRunAiSdkGatewayProbe memoization', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('only invokes the underlying network call once for the same baseURL+token across two calls (cache hit on second)', async () => {
    vi.stubEnv('AMPLITUDE_WIZARD_AI_SDK_PROBE', '1');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://core.amplitude.com/wizard');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'oauth-token-xyz');
    vi.stubEnv('ANTHROPIC_API_KEY', '');

    const mockCreateWizardAiSdkAnthropic = vi.fn(() => () => 'fake-model');
    const mockStreamText = vi.fn(() => ({
      textStream: (async function* () {
        yield 'wizard_ai_sdk_probe_ok';
      })(),
    }));

    vi.doMock('../wizard-ai-sdk-anthropic.js', () => ({
      createWizardAiSdkAnthropic: mockCreateWizardAiSdkAnthropic,
      ensureV1Suffix: (raw: string | undefined) => {
        if (!raw) return raw;
        const trimmed = raw.replace(/\/+$/, '');
        return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
      },
    }));
    vi.doMock('ai', () => ({ streamText: mockStreamText }));

    const { maybeRunAiSdkGatewayProbe, __resetGatewayProbeCacheForTesting } =
      await import('../ai-sdk-gateway-probe.js');
    __resetGatewayProbeCacheForTesting();

    const r1 = await maybeRunAiSdkGatewayProbe({
      useLocalClaude: false,
      useDirectApiKey: false,
    });
    const r2 = await maybeRunAiSdkGatewayProbe({
      useLocalClaude: false,
      useDirectApiKey: false,
    });

    expect(r1.status).toBe('ok');
    expect(r2.status).toBe('ok');
    // The expensive bits (factory construction + stream completion) must run
    // exactly once even though the probe was called twice.
    expect(mockCreateWizardAiSdkAnthropic).toHaveBeenCalledTimes(1);
    expect(mockStreamText).toHaveBeenCalledTimes(1);
  });

  it('briefly caches failures to throttle retry storms during a flapping outage', async () => {
    vi.stubEnv('AMPLITUDE_WIZARD_AI_SDK_PROBE', '1');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://core.amplitude.com/wizard');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'oauth-token-xyz');
    vi.stubEnv('ANTHROPIC_API_KEY', '');

    const mockCreateWizardAiSdkAnthropic = vi.fn(() => () => 'fake-model');
    const mockStreamText = vi.fn(() => {
      const failingStream: AsyncIterable<string> = {
        [Symbol.asyncIterator]() {
          return {
            next() {
              return Promise.reject(new Error('gateway 503'));
            },
          };
        },
      };
      return { textStream: failingStream };
    });

    vi.doMock('../wizard-ai-sdk-anthropic.js', () => ({
      createWizardAiSdkAnthropic: mockCreateWizardAiSdkAnthropic,
      ensureV1Suffix: (raw: string | undefined) => {
        if (!raw) return raw;
        const trimmed = raw.replace(/\/+$/, '');
        return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
      },
    }));
    vi.doMock('ai', () => ({ streamText: mockStreamText }));

    const { maybeRunAiSdkGatewayProbe, __resetGatewayProbeCacheForTesting } =
      await import('../ai-sdk-gateway-probe.js');
    __resetGatewayProbeCacheForTesting();

    // Three rapid retries inside the failure-cache window — the wizard
    // workflow that prompted this regression issued the probe on every
    // initializeAgent call during a recovery loop. Without throttling the
    // user pays 500-1500ms per attempt; with throttling only the first
    // attempt actually hits the gateway and the rest return the cached
    // error immediately.
    const r1 = await maybeRunAiSdkGatewayProbe({
      useLocalClaude: false,
      useDirectApiKey: false,
    });
    const r2 = await maybeRunAiSdkGatewayProbe({
      useLocalClaude: false,
      useDirectApiKey: false,
    });
    const r3 = await maybeRunAiSdkGatewayProbe({
      useLocalClaude: false,
      useDirectApiKey: false,
    });

    expect(r1.status).toBe('error');
    expect(r2.status).toBe('error');
    expect(r3.status).toBe('error');
    // Only ONE actual probe ran inside the cache window. The other two
    // returned the cached error without re-paying the round-trip.
    expect(mockStreamText).toHaveBeenCalledTimes(1);
  });

  it('re-probes after the failure-cache window expires so the wizard recovers when the gateway recovers', async () => {
    vi.stubEnv('AMPLITUDE_WIZARD_AI_SDK_PROBE', '1');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://core.amplitude.com/wizard');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'oauth-token-xyz');
    vi.stubEnv('ANTHROPIC_API_KEY', '');

    // Drive `Date.now()` so the test can fast-forward past the failure TTL
    // without an actual sleep. We can't use vi.useFakeTimers() here because
    // the probe path also awaits real promises (`for await (... of stream)`)
    // which lock up under fake timers.
    const nowSpy = vi.spyOn(Date, 'now');
    let virtualNow = 1_700_000_000_000;
    nowSpy.mockImplementation(() => virtualNow);

    const mockCreateWizardAiSdkAnthropic = vi.fn(() => () => 'fake-model');
    let callCount = 0;
    const mockStreamText = vi.fn(() => {
      callCount += 1;
      if (callCount === 1) {
        const failingStream: AsyncIterable<string> = {
          [Symbol.asyncIterator]() {
            return {
              next() {
                return Promise.reject(new Error('gateway 503'));
              },
            };
          },
        };
        return { textStream: failingStream };
      }
      return {
        textStream: (async function* () {
          yield 'wizard_ai_sdk_probe_ok';
        })(),
      };
    });

    vi.doMock('../wizard-ai-sdk-anthropic.js', () => ({
      createWizardAiSdkAnthropic: mockCreateWizardAiSdkAnthropic,
      ensureV1Suffix: (raw: string | undefined) => {
        if (!raw) return raw;
        const trimmed = raw.replace(/\/+$/, '');
        return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
      },
    }));
    vi.doMock('ai', () => ({ streamText: mockStreamText }));

    const { maybeRunAiSdkGatewayProbe, __resetGatewayProbeCacheForTesting } =
      await import('../ai-sdk-gateway-probe.js');
    __resetGatewayProbeCacheForTesting();

    const r1 = await maybeRunAiSdkGatewayProbe({
      useLocalClaude: false,
      useDirectApiKey: false,
    });
    expect(r1.status).toBe('error');

    // Advance virtual clock past the failure cache window (8s + slack).
    virtualNow += 10_000;

    const r2 = await maybeRunAiSdkGatewayProbe({
      useLocalClaude: false,
      useDirectApiKey: false,
    });
    expect(r2.status).toBe('ok');
    // After the TTL elapses the probe runs again — recovery is not blocked.
    expect(mockStreamText).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });

  it('treats different baseURLs as separate cache entries', async () => {
    vi.stubEnv('AMPLITUDE_WIZARD_AI_SDK_PROBE', '1');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'oauth-token-xyz');
    vi.stubEnv('ANTHROPIC_API_KEY', '');

    const mockCreateWizardAiSdkAnthropic = vi.fn(() => () => 'fake-model');
    const mockStreamText = vi.fn(() => ({
      textStream: (async function* () {
        yield 'wizard_ai_sdk_probe_ok';
      })(),
    }));

    vi.doMock('../wizard-ai-sdk-anthropic.js', () => ({
      createWizardAiSdkAnthropic: mockCreateWizardAiSdkAnthropic,
      ensureV1Suffix: (raw: string | undefined) => {
        if (!raw) return raw;
        const trimmed = raw.replace(/\/+$/, '');
        return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
      },
    }));
    vi.doMock('ai', () => ({ streamText: mockStreamText }));

    const { maybeRunAiSdkGatewayProbe, __resetGatewayProbeCacheForTesting } =
      await import('../ai-sdk-gateway-probe.js');
    __resetGatewayProbeCacheForTesting();

    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://core.amplitude.com/wizard');
    await maybeRunAiSdkGatewayProbe({
      useLocalClaude: false,
      useDirectApiKey: false,
    });
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://eu.amplitude.com/wizard');
    await maybeRunAiSdkGatewayProbe({
      useLocalClaude: false,
      useDirectApiKey: false,
    });

    // Distinct baseURLs do not share cache entries.
    expect(mockStreamText).toHaveBeenCalledTimes(2);
  });
});

describe('enforceAiSdkProbeStrict', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws on error result when strict', async () => {
    vi.stubEnv('AMPLITUDE_WIZARD_AI_SDK_PROBE_STRICT', '1');
    const { enforceAiSdkProbeStrict } = await import(
      '../ai-sdk-gateway-probe.js'
    );
    expect(() =>
      enforceAiSdkProbeStrict({ status: 'error', message: 'boom' }),
    ).toThrow(/boom/);
  });

  it('does not throw on error when strict off', async () => {
    vi.stubEnv('AMPLITUDE_WIZARD_AI_SDK_PROBE_STRICT', '0');
    const { enforceAiSdkProbeStrict } = await import(
      '../ai-sdk-gateway-probe.js'
    );
    expect(() =>
      enforceAiSdkProbeStrict({ status: 'error', message: 'boom' }),
    ).not.toThrow();
  });
});
