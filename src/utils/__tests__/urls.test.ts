import { describe, it, expect, afterEach } from 'vitest';
import {
  getCloudUrlFromRegion,
  getHostFromRegion,
  getLlmGatewayUrlFromHost,
} from '../urls.js';

// ── getCloudUrlFromRegion ─────────────────────────────────────────────────────

describe('getCloudUrlFromRegion', () => {
  it('returns EU cloud URL for eu region', () => {
    expect(getCloudUrlFromRegion('eu')).toBe('https://eu.amplitude.com');
  });

  it('returns US cloud URL for us region', () => {
    expect(getCloudUrlFromRegion('us')).toBe('https://app.amplitude.com');
  });
});

// ── getHostFromRegion ─────────────────────────────────────────────────────────

describe('getHostFromRegion', () => {
  const originalIngestionHost = process.env.AMPLITUDE_WIZARD_INGESTION_HOST;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalIngestionHost === undefined) {
      delete process.env.AMPLITUDE_WIZARD_INGESTION_HOST;
    } else {
      process.env.AMPLITUDE_WIZARD_INGESTION_HOST = originalIngestionHost;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('returns the US prod ingestion host for us region', () => {
    delete process.env.AMPLITUDE_WIZARD_INGESTION_HOST;
    expect(getHostFromRegion('us')).toBe('https://api2.amplitude.com');
  });

  it('returns the EU prod ingestion host for eu region', () => {
    delete process.env.AMPLITUDE_WIZARD_INGESTION_HOST;
    expect(getHostFromRegion('eu')).toBe('https://api.eu.amplitude.com');
  });

  it('never returns a localhost URL even when NODE_ENV=development', () => {
    delete process.env.AMPLITUDE_WIZARD_INGESTION_HOST;
    process.env.NODE_ENV = 'development';
    expect(getHostFromRegion('us')).not.toContain('localhost');
    expect(getHostFromRegion('eu')).not.toContain('localhost');
  });

  it('AMPLITUDE_WIZARD_INGESTION_HOST overrides both regions', () => {
    process.env.AMPLITUDE_WIZARD_INGESTION_HOST = 'https://proxy.example.com';
    expect(getHostFromRegion('us')).toBe('https://proxy.example.com');
    expect(getHostFromRegion('eu')).toBe('https://proxy.example.com');
  });

  it('falls back to prod when AMPLITUDE_WIZARD_INGESTION_HOST is empty or whitespace', () => {
    process.env.AMPLITUDE_WIZARD_INGESTION_HOST = '';
    expect(getHostFromRegion('us')).toBe('https://api2.amplitude.com');
    expect(getHostFromRegion('eu')).toBe('https://api.eu.amplitude.com');

    process.env.AMPLITUDE_WIZARD_INGESTION_HOST = '   ';
    expect(getHostFromRegion('us')).toBe('https://api2.amplitude.com');
    expect(getHostFromRegion('eu')).toBe('https://api.eu.amplitude.com');
  });
});

// ── getLlmGatewayUrlFromHost ──────────────────────────────────────────────────

describe('getLlmGatewayUrlFromHost', () => {
  const originalProxyUrl = process.env.WIZARD_LLM_PROXY_URL;

  afterEach(() => {
    if (originalProxyUrl === undefined) {
      delete process.env.WIZARD_LLM_PROXY_URL;
    } else {
      process.env.WIZARD_LLM_PROXY_URL = originalProxyUrl;
    }
  });

  it('returns the override URL when WIZARD_LLM_PROXY_URL is set', () => {
    process.env.WIZARD_LLM_PROXY_URL = 'http://my-custom-proxy:9999';
    expect(getLlmGatewayUrlFromHost('https://api2.amplitude.com')).toBe(
      'http://my-custom-proxy:9999',
    );
  });

  it('never returns a localhost URL by default', () => {
    delete process.env.WIZARD_LLM_PROXY_URL;
    // Local LLM gateway hosting is rare and must be opt-in via
    // WIZARD_LLM_PROXY_URL — never a default, even in dev/test.
    expect(
      getLlmGatewayUrlFromHost('https://api2.amplitude.com'),
    ).not.toContain('localhost');
    expect(
      getLlmGatewayUrlFromHost('https://api.eu.amplitude.com'),
    ).not.toContain('localhost');
  });

  it('returns EU gateway for eu.amplitude.com host', () => {
    delete process.env.WIZARD_LLM_PROXY_URL;
    expect(getLlmGatewayUrlFromHost('https://eu.amplitude.com')).toBe(
      'https://core.eu.amplitude.com/wizard',
    );
  });

  it('returns EU gateway for api.eu.amplitude.com host', () => {
    delete process.env.WIZARD_LLM_PROXY_URL;
    expect(getLlmGatewayUrlFromHost('https://api.eu.amplitude.com')).toBe(
      'https://core.eu.amplitude.com/wizard',
    );
  });

  it('returns US gateway for api2.amplitude.com host', () => {
    delete process.env.WIZARD_LLM_PROXY_URL;
    expect(getLlmGatewayUrlFromHost('https://api2.amplitude.com')).toBe(
      'https://core.amplitude.com/wizard',
    );
  });
});
