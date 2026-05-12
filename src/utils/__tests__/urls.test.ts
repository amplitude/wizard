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
  const originalZone = process.env.WIZARD_ZONE;

  afterEach(() => {
    if (originalProxyUrl === undefined) {
      delete process.env.WIZARD_LLM_PROXY_URL;
    } else {
      process.env.WIZARD_LLM_PROXY_URL = originalProxyUrl;
    }
    if (originalZone === undefined) {
      delete process.env.WIZARD_ZONE;
    } else {
      process.env.WIZARD_ZONE = originalZone;
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
    delete process.env.WIZARD_ZONE;
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
    delete process.env.WIZARD_ZONE;
    expect(getLlmGatewayUrlFromHost('https://eu.amplitude.com')).toBe(
      'https://core.eu.amplitude.com/wizard',
    );
  });

  it('returns EU gateway for api.eu.amplitude.com host', () => {
    delete process.env.WIZARD_LLM_PROXY_URL;
    delete process.env.WIZARD_ZONE;
    expect(getLlmGatewayUrlFromHost('https://api.eu.amplitude.com')).toBe(
      'https://core.eu.amplitude.com/wizard',
    );
  });

  it('returns US gateway for api2.amplitude.com host', () => {
    delete process.env.WIZARD_LLM_PROXY_URL;
    delete process.env.WIZARD_ZONE;
    expect(getLlmGatewayUrlFromHost('https://api2.amplitude.com')).toBe(
      'https://core.amplitude.com/wizard',
    );
  });

  // ── WIZARD_ZONE precedence (MIGRATION_PLAN.md §7.5) ──────────
  //
  // CI / harness path: an explicit zone selector that bypasses host-based
  // derivation. Lets the eval / bench harness target a specific gateway
  // without threading a stored zone config through. Precedence:
  //   WIZARD_LLM_PROXY_URL > WIZARD_ZONE > host-derived > US default.

  it('WIZARD_ZONE=eu routes to the EU gateway regardless of host', () => {
    delete process.env.WIZARD_LLM_PROXY_URL;
    process.env.WIZARD_ZONE = 'eu';
    // US-shaped host — WIZARD_ZONE wins.
    expect(getLlmGatewayUrlFromHost('https://api2.amplitude.com')).toBe(
      'https://core.eu.amplitude.com/wizard',
    );
  });

  it('WIZARD_ZONE=us routes to the US gateway regardless of host', () => {
    delete process.env.WIZARD_LLM_PROXY_URL;
    process.env.WIZARD_ZONE = 'us';
    // EU-shaped host — WIZARD_ZONE wins.
    expect(getLlmGatewayUrlFromHost('https://api.eu.amplitude.com')).toBe(
      'https://core.amplitude.com/wizard',
    );
  });

  it('WIZARD_ZONE is case-insensitive', () => {
    delete process.env.WIZARD_LLM_PROXY_URL;
    process.env.WIZARD_ZONE = 'EU';
    expect(getLlmGatewayUrlFromHost('https://api2.amplitude.com')).toBe(
      'https://core.eu.amplitude.com/wizard',
    );
  });

  it('invalid WIZARD_ZONE values fall through to host-derived', () => {
    delete process.env.WIZARD_LLM_PROXY_URL;
    process.env.WIZARD_ZONE = 'apac';
    // Garbage value ignored — the EU host wins via host derivation.
    expect(getLlmGatewayUrlFromHost('https://api.eu.amplitude.com')).toBe(
      'https://core.eu.amplitude.com/wizard',
    );
  });

  it('whitespace-only WIZARD_ZONE falls through to host-derived', () => {
    delete process.env.WIZARD_LLM_PROXY_URL;
    process.env.WIZARD_ZONE = '   ';
    expect(getLlmGatewayUrlFromHost('https://api2.amplitude.com')).toBe(
      'https://core.amplitude.com/wizard',
    );
  });

  it('WIZARD_LLM_PROXY_URL beats WIZARD_ZONE', () => {
    process.env.WIZARD_LLM_PROXY_URL = 'http://gateway-test:8010';
    process.env.WIZARD_ZONE = 'eu';
    // Full URL override wins over zone selector.
    expect(getLlmGatewayUrlFromHost('https://api2.amplitude.com')).toBe(
      'http://gateway-test:8010',
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
