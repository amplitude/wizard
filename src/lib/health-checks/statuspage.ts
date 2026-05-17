import { createLogger } from '../observability/logger';
import { fetchWithTimeout } from './_fetch';
import {
  ServiceHealthStatus,
  type BaseHealthResult,
  type ComponentHealthResult,
} from './types';

// ---------------------------------------------------------------------------
// Statuspage.io v2 API helpers
// https://metastatuspage.com/api
//
// status.json  – page-level rollup; indicator is one of: none | minor | major | critical
// summary.json – same rollup + component list; component status is one of:
//   operational | degraded_performance | partial_outage | major_outage | under_maintenance
//   https://support.atlassian.com/statuspage/docs/show-service-status-with-components
//
// Performance notes:
//
// Aggregate `checkAllExternalServices()` only needs to hit `summary.json`
// for the three Statuspage hosts — it returns BOTH the page-level
// indicator and the component list in a single response. The combined
// helpers below (`checkAmplitudeStatusAndComponents`, etc.) make one
// request and derive both results, cutting three round-trips out of the
// cold-start aggregate check.
//
// The standalone `check*OverallHealth` / `check*ComponentHealth` exports
// are retained for ad-hoc callers (e.g. `OutageScreen` polls overall
// only, no point pulling component data every 30s).
//
// HTTP connection reuse: Node 20+'s built-in `fetch` is implemented on
// top of undici, which maintains an internal connection pool keyed by
// origin and reuses TLS sockets across requests automatically. We do
// NOT pass `keepalive: true` — that flag is the WHATWG service-worker
// "request can outlive the page" semantic, not a connection-reuse
// hint (https://github.com/nodejs/undici/issues/2169). The parallel
// fetches against the same Statuspage host already share a socket via
// undici's pool without any extra configuration.
// ---------------------------------------------------------------------------

const log = createLogger('health-checks/statuspage');

interface StatuspageStatusResponse {
  status?: { indicator?: string; description?: string };
}

interface StatuspageSummaryResponse extends StatuspageStatusResponse {
  components?: { id: string; name: string; status: string }[];
}

/**
 * Map a Statuspage page-level indicator to our internal status enum.
 *
 * Unknown / unexpected values are intentionally treated as Healthy with a
 * logged warning. Statuspage occasionally adds new indicator values, and
 * silently flipping every wizard run to "Degraded" on schema drift would
 * turn a benign upstream change into a hard blocker. Prefer false-negative
 * (we miss a new degraded state for a release) over false-positive (we
 * block every user until we ship a patch).
 */
function mapIndicator(v: string | null | undefined): ServiceHealthStatus {
  switch (v) {
    case 'none':
      return ServiceHealthStatus.Healthy;
    case 'minor':
      return ServiceHealthStatus.Degraded;
    case 'major':
    case 'critical':
      return ServiceHealthStatus.Down;
    default:
      if (v != null && v !== '') {
        log.warn('unknown statuspage indicator — defaulting to healthy', {
          indicator: v,
        });
      }
      return ServiceHealthStatus.Healthy;
  }
}

/**
 * Map a Statuspage component status to our internal status enum.
 *
 * Same fail-safe rationale as `mapIndicator`: unknown values default to
 * Healthy + warning so schema drift on the upstream API can't silently
 * block wizard runs.
 */
function mapComponentRaw(v: string | null | undefined): ServiceHealthStatus {
  switch (v) {
    case 'operational':
      return ServiceHealthStatus.Healthy;
    case 'degraded_performance':
    case 'under_maintenance':
      return ServiceHealthStatus.Degraded;
    case 'partial_outage':
    case 'major_outage':
      return ServiceHealthStatus.Down;
    default:
      if (v != null && v !== '') {
        log.warn(
          'unknown statuspage component status — defaulting to healthy',
          {
            component_status: v,
          },
        );
      }
      return ServiceHealthStatus.Healthy;
  }
}

function errResult(error: string): BaseHealthResult {
  return { status: ServiceHealthStatus.Degraded, error };
}

function componentErrResult(error: string): ComponentHealthResult {
  return { status: ServiceHealthStatus.Degraded, error };
}

async function fetchStatuspageIndicator(
  url: string,
  timeoutMs = 5000,
): Promise<BaseHealthResult> {
  const fetchResult = await fetchWithTimeout(url, timeoutMs);
  if (!fetchResult.ok) return errResult(fetchResult.error);

  const res = fetchResult.response;
  if (!res.ok) return errResult(`HTTP ${res.status}`);

  try {
    const data = (await res.json()) as StatuspageStatusResponse;
    const indicator = data.status?.indicator ?? null;
    return {
      status: mapIndicator(indicator),
      rawIndicator: indicator ?? undefined,
    };
  } catch (e) {
    return errResult(e instanceof Error ? e.message : 'Unknown error');
  }
}

/**
 * Single-fetch helper that returns BOTH the page-level indicator result and
 * the component-level result from one `summary.json` response. This is the
 * primitive the aggregate readiness check uses.
 */
export async function fetchStatuspageOverallAndComponents(
  url: string,
  timeoutMs = 5000,
): Promise<{ overall: BaseHealthResult; components: ComponentHealthResult }> {
  const fetchResult = await fetchWithTimeout(url, timeoutMs);
  if (!fetchResult.ok) {
    const msg = fetchResult.error;
    return { overall: errResult(msg), components: componentErrResult(msg) };
  }

  const res = fetchResult.response;
  if (!res.ok) {
    const msg = `HTTP ${res.status}`;
    return { overall: errResult(msg), components: componentErrResult(msg) };
  }

  try {
    const data = (await res.json()) as StatuspageSummaryResponse;
    const indicator = data.status?.indicator ?? null;
    const overallStatus = mapIndicator(indicator);

    const overall: BaseHealthResult = {
      status: overallStatus,
      rawIndicator: indicator ?? undefined,
    };

    const affected = (data.components ?? [])
      .map((c) => ({
        name: c.name,
        status: mapComponentRaw(c.status),
        rawStatus: c.status,
      }))
      .filter((c) => c.status !== ServiceHealthStatus.Healthy);

    const components: ComponentHealthResult = {
      status:
        affected.length > 0 ? ServiceHealthStatus.Degraded : overallStatus,
      rawIndicator: indicator ?? undefined,
      degradedOrDownComponents: affected.length > 0 ? affected : undefined,
    };

    return { overall, components };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return { overall: errResult(msg), components: componentErrResult(msg) };
  }
}

/**
 * Convenience wrapper around `fetchStatuspageOverallAndComponents` that
 * returns only the component-level result — used by the
 * `check*ComponentHealth` exports below.
 */
async function fetchStatuspageSummaryComponents(
  url: string,
  timeoutMs = 5000,
): Promise<ComponentHealthResult> {
  const combined = await fetchStatuspageOverallAndComponents(url, timeoutMs);
  return combined.components;
}

// ---------------------------------------------------------------------------
// Statuspage URLs (single source of truth)
// ---------------------------------------------------------------------------

const URLS = {
  amplitudeStatus: 'https://status.amplitude.com/api/v2/status.json',
  amplitudeSummary: 'https://status.amplitude.com/api/v2/summary.json',
  githubStatus: 'https://www.githubstatus.com/api/v2/status.json',
  npmStatus: 'https://status.npmjs.org/api/v2/status.json',
  npmSummary: 'https://status.npmjs.org/api/v2/summary.json',
  cloudflareStatus: 'https://www.cloudflarestatus.com/api/v2/status.json',
  cloudflareSummary: 'https://www.cloudflarestatus.com/api/v2/summary.json',
} as const;

// ---------------------------------------------------------------------------
// Individual statuspage-backed checks
// ---------------------------------------------------------------------------

/** Model provider health — no-op, wizard uses Vertex AI via proxy. */
export const checkAnthropicHealth = (): Promise<BaseHealthResult> =>
  Promise.resolve({
    status: ServiceHealthStatus.Healthy,
    pageUrl: '',
  });

export const checkAmplitudeOverallHealth = (): Promise<BaseHealthResult> =>
  fetchStatuspageIndicator(URLS.amplitudeStatus);

export const checkAmplitudeComponentHealth =
  (): Promise<ComponentHealthResult> =>
    fetchStatuspageSummaryComponents(URLS.amplitudeSummary);

export const checkGithubHealth = (): Promise<BaseHealthResult> =>
  fetchStatuspageIndicator(URLS.githubStatus);

export const checkNpmOverallHealth = (): Promise<BaseHealthResult> =>
  fetchStatuspageIndicator(URLS.npmStatus);

export const checkNpmComponentHealth = (): Promise<ComponentHealthResult> =>
  fetchStatuspageSummaryComponents(URLS.npmSummary);

export const checkCloudflareOverallHealth = (): Promise<BaseHealthResult> =>
  fetchStatuspageIndicator(URLS.cloudflareStatus);

export const checkCloudflareComponentHealth =
  (): Promise<ComponentHealthResult> =>
    fetchStatuspageSummaryComponents(URLS.cloudflareSummary);

// ---------------------------------------------------------------------------
// Combined (single-fetch) statuspage checks
//
// Each of these issues ONE GET to `summary.json` and derives both the
// page-level indicator result and the component-level result from it. Use
// these in aggregate flows; use the individual `check*Overall` /
// `check*Component` functions only when one half of the data is genuinely
// not needed (e.g. `OutageScreen` polling).
// ---------------------------------------------------------------------------

export const checkAmplitudeStatusAndComponents = (): Promise<{
  overall: BaseHealthResult;
  components: ComponentHealthResult;
}> => fetchStatuspageOverallAndComponents(URLS.amplitudeSummary);

export const checkNpmStatusAndComponents = (): Promise<{
  overall: BaseHealthResult;
  components: ComponentHealthResult;
}> => fetchStatuspageOverallAndComponents(URLS.npmSummary);

export const checkCloudflareStatusAndComponents = (): Promise<{
  overall: BaseHealthResult;
  components: ComponentHealthResult;
}> => fetchStatuspageOverallAndComponents(URLS.cloudflareSummary);
