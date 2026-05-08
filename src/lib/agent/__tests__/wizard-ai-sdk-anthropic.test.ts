import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock @ai-sdk/anthropic so we can inspect what the factory passes in without
// pulling the real provider. Same pattern as console-query.test.ts.
const mockCreateAnthropic = vi.fn();
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: (opts: unknown) => mockCreateAnthropic(opts),
}));

import {
  createWizardAiSdkAnthropic,
  ensureV1Suffix,
} from '../wizard-ai-sdk-anthropic.js';

describe('ensureV1Suffix', () => {
  it('appends /v1 when the URL has no version segment', () => {
    expect(ensureV1Suffix('https://core.amplitude.com/wizard')).toBe(
      'https://core.amplitude.com/wizard/v1',
    );
  });

  it('is idempotent when the URL already ends in /v1', () => {
    expect(ensureV1Suffix('https://core.amplitude.com/wizard/v1')).toBe(
      'https://core.amplitude.com/wizard/v1',
    );
  });

  it('respects an existing /vN segment (e.g. /v2)', () => {
    expect(ensureV1Suffix('https://example.com/api/v2')).toBe(
      'https://example.com/api/v2',
    );
  });

  it('strips a trailing slash before appending /v1', () => {
    expect(ensureV1Suffix('https://core.amplitude.com/wizard/')).toBe(
      'https://core.amplitude.com/wizard/v1',
    );
  });

  it('strips multiple trailing slashes before appending /v1', () => {
    expect(ensureV1Suffix('https://core.amplitude.com/wizard///')).toBe(
      'https://core.amplitude.com/wizard/v1',
    );
  });

  it('strips a trailing slash after a /v1 suffix (still idempotent)', () => {
    expect(ensureV1Suffix('https://core.amplitude.com/wizard/v1/')).toBe(
      'https://core.amplitude.com/wizard/v1',
    );
  });

  it('returns undefined when input is undefined', () => {
    expect(ensureV1Suffix(undefined)).toBeUndefined();
  });

  it('returns the empty string unchanged', () => {
    // Empty string is falsy; the helper bails before normalization so callers
    // can pipe through `process.env.ANTHROPIC_BASE_URL` without guarding.
    expect(ensureV1Suffix('')).toBe('');
  });
});

describe('createWizardAiSdkAnthropic — baseURL normalization', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mockCreateAnthropic.mockReset();
  });

  it('normalizes an explicit baseURL via ensureV1Suffix', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    createWizardAiSdkAnthropic({
      baseURL: 'https://core.amplitude.com/wizard',
    });
    expect(mockCreateAnthropic).toHaveBeenCalledTimes(1);
    const opts = mockCreateAnthropic.mock.calls[0][0] as { baseURL?: string };
    expect(opts.baseURL).toBe('https://core.amplitude.com/wizard/v1');
  });

  it('normalizes ANTHROPIC_BASE_URL when no explicit baseURL is provided', () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://core.amplitude.com/wizard');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    createWizardAiSdkAnthropic();
    const opts = mockCreateAnthropic.mock.calls[0][0] as { baseURL?: string };
    expect(opts.baseURL).toBe('https://core.amplitude.com/wizard/v1');
  });

  it('leaves an explicit baseURL that already ends in /v1 untouched', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    createWizardAiSdkAnthropic({
      baseURL: 'https://core.amplitude.com/wizard/v1',
    });
    const opts = mockCreateAnthropic.mock.calls[0][0] as { baseURL?: string };
    expect(opts.baseURL).toBe('https://core.amplitude.com/wizard/v1');
  });

  it('omits baseURL from createAnthropic when neither opts nor env supplies one', () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', '');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    createWizardAiSdkAnthropic();
    const opts = mockCreateAnthropic.mock.calls[0][0] as { baseURL?: string };
    expect(opts.baseURL).toBeUndefined();
  });
});

// Integration: prove that the wizard's URL resolver + baseURL normalizer
// land on the production wizard-api endpoint that wizard-api expects.
//
// wizard-api routes (`amplitude/wizard-api`):
//   - next.config.ts            → basePath: '/web-api/wizard'
//   - src/app/v1/messages/route.ts → POST handler, requires either
//                                    `Authorization: Bearer …` or `x-api-key`.
//
// The Claude Agent SDK appends `/v1/messages` to ANTHROPIC_BASE_URL; the AI
// SDK appends `/messages` to baseURL (we add `/v1` via ensureV1Suffix). Both
// must resolve to `https://wizard.amplitude.com/web-api/wizard/v1/messages`
// for traffic to land on the Vertex proxy.
describe('integration: LLM proxy URL points at wizard.amplitude.com', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mockCreateAnthropic.mockReset();
  });

  it('resolves to https://wizard.amplitude.com/web-api/wizard for any region', async () => {
    // Import lazily so we pick up the unstubbed env state per test.
    const { getLlmGatewayUrlFromHost } = await import('../../../utils/urls.js');
    vi.stubEnv('WIZARD_LLM_PROXY_URL', '');
    vi.stubEnv('WIZARD_ZONE', '');

    expect(getLlmGatewayUrlFromHost('https://api2.amplitude.com')).toBe(
      'https://wizard.amplitude.com/web-api/wizard',
    );
    expect(getLlmGatewayUrlFromHost('https://api.eu.amplitude.com')).toBe(
      'https://wizard.amplitude.com/web-api/wizard',
    );
  });

  it('AI SDK provider posts to wizard.amplitude.com/web-api/wizard/v1/messages', async () => {
    const { getLlmGatewayUrlFromHost } = await import('../../../utils/urls.js');
    vi.stubEnv('WIZARD_LLM_PROXY_URL', '');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    const gateway = getLlmGatewayUrlFromHost('https://api2.amplitude.com');

    createWizardAiSdkAnthropic({ baseURL: gateway });

    const opts = mockCreateAnthropic.mock.calls[0][0] as { baseURL?: string };
    // ensureV1Suffix adds the /v1; @ai-sdk/anthropic then appends /messages
    // to land on the wizard-api `/v1/messages` POST handler.
    expect(opts.baseURL).toBe('https://wizard.amplitude.com/web-api/wizard/v1');
  });

  it('AI SDK provider forwards an Authorization Bearer header — wizard-api requires bearer or x-api-key', async () => {
    const { getLlmGatewayUrlFromHost } = await import('../../../utils/urls.js');
    vi.stubEnv('WIZARD_LLM_PROXY_URL', '');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'amp-bearer-xyz');
    delete process.env.ANTHROPIC_API_KEY;
    const gateway = getLlmGatewayUrlFromHost('https://api2.amplitude.com');

    createWizardAiSdkAnthropic({ baseURL: gateway });

    const opts = mockCreateAnthropic.mock.calls[0][0] as {
      headers?: Record<string, string>;
      apiKey?: string;
      authToken?: string;
    };
    // resolveAnthropicAuth (src/lib/agent/anthropic-auth.ts) reads
    // ANTHROPIC_AUTH_TOKEN and forwards it as `authToken`, which the
    // @ai-sdk/anthropic provider sends as `Authorization: Bearer <token>`
    // on the wire. wizard-api's checkClientAuth (src/lib/vertex.ts) accepts
    // anything non-empty in `Authorization: Bearer` or `x-api-key` — the
    // validation TODO on line 238 keeps the door open intentionally.
    expect(opts.authToken).toBe('amp-bearer-xyz');
  });

  it('preserves WIZARD_LLM_PROXY_URL escape hatch for dev / staging', async () => {
    const { getLlmGatewayUrlFromHost } = await import('../../../utils/urls.js');
    vi.stubEnv('WIZARD_LLM_PROXY_URL', 'http://localhost:8010');

    expect(getLlmGatewayUrlFromHost('https://api2.amplitude.com')).toBe(
      'http://localhost:8010',
    );
  });
});
