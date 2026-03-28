import { describe, it, expect, afterEach } from 'vitest';
import { getCloudUrlFromRegion, getLlmGatewayUrlFromHost } from '../urls.js';

// ── getCloudUrlFromRegion ─────────────────────────────────────────────────────

describe('getCloudUrlFromRegion', () => {
  it('returns EU cloud URL for eu region', () => {
    expect(getCloudUrlFromRegion('eu')).toBe('https://eu.amplitude.com');
  });

  it('returns US cloud URL for us region', () => {
    expect(getCloudUrlFromRegion('us')).toBe('https://app.amplitude.com');
  });
});

// ── getLlmGatewayUrlFromHost ──────────────────────────────────────────────────

describe('getLlmGatewayUrlFromHost', () => {
  const originalProxyUrl = process.env.WIZARD_LLM_PROXY_URL;
  const originalDevToken = process.env.WIZARD_PROXY_DEV_TOKEN;

  afterEach(() => {
    // Restore env vars after each test
    if (originalProxyUrl === undefined) {
      delete process.env.WIZARD_LLM_PROXY_URL;
    } else {
      process.env.WIZARD_LLM_PROXY_URL = originalProxyUrl;
    }
    if (originalDevToken === undefined) {
      delete process.env.WIZARD_PROXY_DEV_TOKEN;
    } else {
      process.env.WIZARD_PROXY_DEV_TOKEN = originalDevToken;
    }
  });

  it('returns the override URL when WIZARD_LLM_PROXY_URL is set', () => {
    process.env.WIZARD_LLM_PROXY_URL = 'http://my-custom-proxy:9999';
    delete process.env.WIZARD_PROXY_DEV_TOKEN;
    expect(getLlmGatewayUrlFromHost('https://api2.amplitude.com')).toBe(
      'http://my-custom-proxy:9999',
    );
  });

  it('ignores WIZARD_PROXY_DEV_TOKEN and returns prod URL', () => {
    delete process.env.WIZARD_LLM_PROXY_URL;
    process.env.WIZARD_PROXY_DEV_TOKEN = 'dev-token';
    expect(getLlmGatewayUrlFromHost('https://api2.amplitude.com')).toBe(
      'https://core.amplitude.com/wizard',
    );
  });

  it('returns localhost proxy for localhost host', () => {
    delete process.env.WIZARD_LLM_PROXY_URL;
    delete process.env.WIZARD_PROXY_DEV_TOKEN;
    expect(getLlmGatewayUrlFromHost('http://localhost:8010')).toBe(
      'http://localhost:3030/wizard',
    );
  });

  it('returns EU gateway for eu.amplitude.com host', () => {
    delete process.env.WIZARD_LLM_PROXY_URL;
    delete process.env.WIZARD_PROXY_DEV_TOKEN;
    expect(getLlmGatewayUrlFromHost('https://eu.amplitude.com')).toBe(
      'https://core.eu.amplitude.com/wizard',
    );
  });

  it('returns EU gateway for api.eu.amplitude.com host', () => {
    delete process.env.WIZARD_LLM_PROXY_URL;
    delete process.env.WIZARD_PROXY_DEV_TOKEN;
    expect(getLlmGatewayUrlFromHost('https://api.eu.amplitude.com')).toBe(
      'https://core.eu.amplitude.com/wizard',
    );
  });

  it('returns US gateway for api2.amplitude.com host', () => {
    delete process.env.WIZARD_LLM_PROXY_URL;
    delete process.env.WIZARD_PROXY_DEV_TOKEN;
    expect(getLlmGatewayUrlFromHost('https://api2.amplitude.com')).toBe(
      'https://core.amplitude.com/wizard',
    );
  });
});
