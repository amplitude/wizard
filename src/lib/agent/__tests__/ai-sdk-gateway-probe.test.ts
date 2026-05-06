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
      model: 'claude-sonnet-4-6',
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
      model: 'claude-sonnet-4-6',
    });
    expect(r.status).toBe('skipped');
    if (r.status === 'skipped') {
      expect(r.reason).toContain('local Claude');
    }
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
