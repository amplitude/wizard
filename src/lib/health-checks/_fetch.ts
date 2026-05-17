/**
 * Shared low-level fetch helper for health checks.
 *
 * The three callers (`endpoints.ts::fetchEndpointHealth`,
 * `statuspage.ts::fetchStatuspageIndicator`, and
 * `statuspage.ts::fetchStatuspageOverallAndComponents`) all need the same
 * timeout-via-AbortController + AbortError-distinct-from-other-errors
 * pattern. Centralising it here keeps the timeout / abort semantics in one
 * place — if we ever switch off Node 20's built-in fetch (e.g. for a
 * custom dispatcher with HTTP/2 reuse), there's one site to edit.
 *
 * Performance note (carried over from the call sites): Node 20+'s built-in
 * fetch is implemented on top of undici and maintains an internal
 * connection pool keyed by origin and reuses TLS sockets across requests
 * automatically — no flag required. We deliberately do NOT pass
 * `keepalive: true`: that's the WHATWG service-worker "outlive the page"
 * semantic, not a connection-reuse hint
 * (https://github.com/nodejs/undici/issues/2169). The parallel fetches
 * against the same Statuspage host already share a socket via undici's
 * pool without any extra configuration.
 */

export interface FetchOk {
  ok: true;
  response: Response;
}

export interface FetchErr {
  ok: false;
  /** Human-readable error message. Already normalised for "request timed out". */
  error: string;
}

export type FetchResult = FetchOk | FetchErr;

/**
 * Fetch a URL with an explicit timeout. Returns a discriminated result so
 * callers can map success/failure into their own status enum without
 * re-implementing the abort / try / catch dance.
 *
 * The response body is intentionally NOT consumed here — callers decide
 * whether they need JSON, text, or just the status code.
 */
export async function fetchWithTimeout(
  url: string,
  timeoutMs = 5000,
): Promise<FetchResult> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return { ok: true, response };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return { ok: false, error: 'Request timed out' };
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  } finally {
    clearTimeout(tid);
  }
}
