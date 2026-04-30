import { describe, it, expect, afterEach } from 'vitest';
import {
  getCloudUrlFromRegion,
  getHostFromRegion,
  getLlmGatewayUrlFromHost,
  getMcpHostFromRegion,
  getMcpUrlFromZone,
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

// ── getMcpHostFromRegion ──────────────────────────────────────────────────────

describe('getMcpHostFromRegion', () => {
  it('returns the EU MCP host for EU region', () => {
    expect(getMcpHostFromRegion('eu')).toBe('https://mcp.eu.amplitude.com');
  });

  it('returns the US MCP host for US region', () => {
    expect(getMcpHostFromRegion('us')).toBe('https://mcp.amplitude.com');
  });
});

// ── getMcpUrlFromZone ─────────────────────────────────────────────────────────

describe('getMcpUrlFromZone', () => {
  const originalMcpUrl = process.env.MCP_URL;

  afterEach(() => {
    if (originalMcpUrl === undefined) {
      delete process.env.MCP_URL;
    } else {
      process.env.MCP_URL = originalMcpUrl;
    }
  });

  // Regression — every prior wizard release hardcoded the US MCP host
  // regardless of the user's region. EU users got their MCP queries
  // (event/property lookups, dashboard creation, taxonomy) routed
  // through US infrastructure, and the URL written into editor configs
  // by `addMCPServerToClientsStep` persisted that wrong host past the
  // wizard run.
  it('returns the EU MCP /mcp endpoint for EU zone', () => {
    delete process.env.MCP_URL;
    expect(getMcpUrlFromZone('eu')).toBe('https://mcp.eu.amplitude.com/mcp');
  });

  it('returns the US MCP /mcp endpoint for US zone', () => {
    delete process.env.MCP_URL;
    expect(getMcpUrlFromZone('us')).toBe('https://mcp.amplitude.com/mcp');
  });

  it('returns localhost when local: true', () => {
    delete process.env.MCP_URL;
    // local trumps zone — both regions resolve to the dev server.
    expect(getMcpUrlFromZone('us', { local: true })).toBe(
      'http://localhost:8787/mcp',
    );
    expect(getMcpUrlFromZone('eu', { local: true })).toBe(
      'http://localhost:8787/mcp',
    );
  });

  it('honors MCP_URL env override regardless of zone', () => {
    process.env.MCP_URL = 'https://staging-mcp.example.com/mcp';
    expect(getMcpUrlFromZone('eu')).toBe('https://staging-mcp.example.com/mcp');
    expect(getMcpUrlFromZone('us')).toBe('https://staging-mcp.example.com/mcp');
  });

  it('falls through to zone defaults on whitespace-only MCP_URL', () => {
    process.env.MCP_URL = '   ';
    expect(getMcpUrlFromZone('eu')).toBe('https://mcp.eu.amplitude.com/mcp');
  });

  it('returns the /sse endpoint when path: "sse" is requested', () => {
    delete process.env.MCP_URL;
    expect(getMcpUrlFromZone('eu', { path: 'sse' })).toBe(
      'https://mcp.eu.amplitude.com/sse',
    );
  });
});
