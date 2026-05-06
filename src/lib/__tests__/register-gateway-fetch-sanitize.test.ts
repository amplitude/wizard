import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  requestUrlIncludesMessagesApi,
  installGatewayFetchSanitizer,
} from '../register-gateway-fetch-sanitize.js';

describe('requestUrlIncludesMessagesApi', () => {
  it('matches string URLs', () => {
    expect(
      requestUrlIncludesMessagesApi(
        'https://core.amplitude.com/wizard/v1/messages',
      ),
    ).toBe(true);
    expect(requestUrlIncludesMessagesApi('https://example.com/health')).toBe(
      false,
    );
  });

  it('matches URL objects', () => {
    expect(
      requestUrlIncludesMessagesApi(
        new URL('https://core.amplitude.com/wizard/v1/messages'),
      ),
    ).toBe(true);
  });
});

describe('installGatewayFetchSanitizer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sanitizes fetch init for /v1/messages only', async () => {
    const prior = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', prior);

    installGatewayFetchSanitizer();

    const body = JSON.stringify({
      tools: [
        {
          name: 't',
          input_schema: { type: 'object', $schema: 'http://x', properties: {} },
        },
      ],
    });

    await globalThis.fetch('https://gw.test/v1/messages', {
      method: 'POST',
      headers: { 'anthropic-beta': 'x', 'content-type': 'application/json' },
      body,
    });

    expect(prior).toHaveBeenCalledTimes(1);
    const [, init] = prior.mock.calls[0] as [
      string,
      Parameters<typeof fetch>[1],
    ];
    const h = new Headers(init.headers);
    expect(h.has('anthropic-beta')).toBe(false);
    const parsed = JSON.parse(init.body as string) as {
      tools: Array<{ input_schema: Record<string, unknown> }>;
    };
    expect(parsed.tools[0].input_schema['$schema']).toBeUndefined();

    await globalThis.fetch('https://gw.test/v1/health');
    expect(prior).toHaveBeenCalledTimes(2);
    const [, init2] = prior.mock.calls[1] as [
      string,
      Parameters<typeof fetch>[1],
    ];
    expect(init2).toBeUndefined();
  });
});
