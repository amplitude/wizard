import { ServiceHealthStatus, type BaseHealthResult } from './types';

// ---------------------------------------------------------------------------
// Direct endpoint health checks
//
// These ping Amplitude-owned services directly (no Statuspage intermediary).
// A non-expected HTTP status or any network error is treated as Down.
//
// LLM Gateway – FastAPI service
//   Source: amplitude/services/llm-gateway/src/llm_gateway/api/health.py
//   GET /_liveness → 200 {"status":"alive"}
//
// MCP – Cloudflare Worker
//   Source: amplitude/services/mcp/src/index.ts
//   GET / → 200 (HTML landing page)
// ---------------------------------------------------------------------------

function downResult(error: string): BaseHealthResult {
  return { status: ServiceHealthStatus.Down, error };
}

async function fetchEndpointHealth(
  url: string,
  timeoutMs = 5000,
  expectedStatus = 200,
): Promise<BaseHealthResult> {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    // keepalive: true lets Node's built-in fetch reuse the underlying TLS
    // socket across the parallel readiness checks, saving ~100ms per check
    // on cold start when several endpoints share a host (or sit behind the
    // same edge network). Cheap to leave on for single-shot endpoints too.
    const res = await fetch(url, {
      signal: controller.signal,
      keepalive: true,
    });
    clearTimeout(tid);

    if (res.status === expectedStatus) {
      return {
        status: ServiceHealthStatus.Healthy,
        rawIndicator: `HTTP ${res.status}`,
      };
    }
    return downResult(`HTTP ${res.status}`);
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError')
      return downResult('Request timed out');
    return downResult(e instanceof Error ? e.message : 'Unknown error');
  }
}

export const checkLlmGatewayHealth = (): Promise<BaseHealthResult> =>
  fetchEndpointHealth('https://gateway.us.amplitude.com/_liveness');

export const checkMcpHealth = (): Promise<BaseHealthResult> =>
  fetchEndpointHealth('https://mcp.amplitude.com/');
