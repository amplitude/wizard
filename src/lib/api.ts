import axios, { AxiosError } from 'axios';
import https from 'node:https';
import { z } from 'zod';
import { analytics } from '../utils/analytics.js';
import { logToFile } from '../utils/debug.js';
import {
  AMPLITUDE_ZONE_SETTINGS,
  WIZARD_USER_AGENT,
  type AmplitudeZone,
} from './constants.js';
import { callAmplitudeMcp } from './mcp-with-fallback.js';

// ── Shared axios client ──────────────────────────────────────────────
//
// All Amplitude HTTP calls in this module share one axios instance so that:
//   1. TCP/TLS connections are reused via keep-alive (cheaper round-trips
//      when the wizard makes several Data API / App API calls back-to-back).
//   2. Every request has a sane default timeout — without this, a hung
//      Data API would freeze the wizard forever (`fetchAmplitudeUser`,
//      `fetchBranches`, `fetchProjectEventTypes`, `fetchSources`,
//      `fetchOwnedDashboards`, `fetchProjectActivationStatus` previously
//      had no timeout). 15s is generous for GraphQL reads but bounded.
//   3. Per-call `timeout` overrides still work — axios merges request config
//      on top of instance defaults, so callers like `createAmplitudeApp`
//      (20s) and `fetchSlackInstallUrl` (10s) keep their explicit values.
//
// Scope is intentionally limited to this file — other HTTP callers
// (e.g. `src/lib/planned-events.ts`, `src/utils/direct-signup.ts`) keep
// their existing axios usage and are out of scope for this change.
const httpsAgent = new https.Agent({ keepAlive: true });
const apiClient = axios.create({ timeout: 15_000, httpsAgent });

// ── App API URL helper ────────────────────────────────────────────────

/**
 * Builds the org-scoped App API GraphQL endpoint for the given zone and orgId.
 */
function appApiUrl(
  zone: AmplitudeZone,
  orgId: string,
  queryName?: string,
): string {
  const base = AMPLITUDE_ZONE_SETTINGS[zone].appApiUrlBase;
  // Ensure the base ends with /graphql/org/ so we can append orgId.
  const graphqlBase = base.endsWith('/graphql/org/')
    ? base
    : `${base.replace(/\/$/, '')}/graphql/org/`;
  const url = `${graphqlBase}${orgId}`;
  return queryName ? `${url}?q=${queryName}` : url;
}

// ── Amplitude GraphQL types ───────────────────────────────────────────

const AmplitudeUserSchema = z.object({
  data: z.object({
    orgs: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        user: z.object({
          id: z.string(),
          firstName: z.string(),
          lastName: z.string(),
          email: z.string(),
        }),
        workspaces: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            environments: z
              .array(
                z.object({
                  name: z.string(),
                  rank: z.number(),
                  app: z
                    .object({
                      id: z.string(),
                      apiKey: z.string().nullable().optional(),
                    })
                    .nullable(),
                }),
              )
              .nullable()
              .optional(),
          }),
        ),
      }),
    ),
  }),
});

export type AmplitudeOrg = {
  id: string;
  name: string;
  projects: Array<{
    id: string;
    name: string;
    environments?: Array<{
      name: string;
      rank: number;
      app: { id: string; apiKey?: string | null } | null;
    }> | null;
  }>;
};

/**
 * Shared project type for environment helpers.
 *
 * NOTE: In Amplitude's backend GraphQL schema this layer is called a
 * "workspace"; the wizard's wire-level queries still use the `workspaces`
 * field name. The TS surface, session state, and user-facing UI all use
 * "project" to match the website and the rest of the Amplitude product.
 */
export type AmplitudeProject = AmplitudeOrg['projects'][number];

/**
 * Extract the primary Amplitude app ID from a project.
 * Picks the lowest-rank environment that has an app ID.
 * Returns null if no such environment exists.
 *
 * Note: "app" is the canonical term for the ingestion surface that owns an
 * API key, per amplitude/amplitude (`app_id`) and amplitude/javascript
 * (`App` GraphQL type). Amplitude's UI also labels this "Project ID" in
 * some places — it's the numeric app ID, not the project layer above it.
 */
export function extractAppId(project: AmplitudeProject): string | null {
  return (
    (project.environments ?? [])
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .find((e) => e.app?.id)?.app?.id ?? null
  );
}

export type AmplitudeUserInfo = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  orgs: AmplitudeOrg[];
};

const ORGS_QUERY = `
query orgs {
  orgs {
    id
    name
    user {
      id
      firstName
      lastName
      email
    }
    workspaces {
      id
      name
      environments {
        name
        rank
        app { id apiKey }
      }
    }
  }
}`;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly endpoint?: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Fetches the authenticated user's org/project info from Amplitude's Data API.
 * Uses the OAuth id_token as the Authorization header (same as ampli CLI).
 *
 * The backend GraphQL response carries a `workspaces` field; we rename it to
 * `projects` at this boundary so the rest of the wizard only sees the
 * user-facing terminology.
 */
export async function fetchAmplitudeUser(
  idToken: string,
  zone: AmplitudeZone,
): Promise<AmplitudeUserInfo> {
  const { dataApiUrl } = AMPLITUDE_ZONE_SETTINGS[zone];
  try {
    const response = await apiClient.post(
      dataApiUrl,
      { query: ORGS_QUERY },
      {
        headers: {
          Authorization: idToken,
          'Content-Type': 'application/json',
          'User-Agent': WIZARD_USER_AGENT,
        },
      },
    );

    const parsed = AmplitudeUserSchema.parse(response.data);
    const orgs = parsed.data.orgs;
    const user = orgs[0]?.user;
    if (!user) throw new ApiError('No user data returned from Amplitude API');

    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      orgs: orgs.map((org) => ({
        id: org.id,
        name: org.name,
        projects: org.workspaces,
      })),
    };
  } catch (error) {
    const apiError = handleApiError(error, 'fetch Amplitude user data');
    analytics.captureException(apiError, { endpoint: dataApiUrl });
    throw apiError;
  }
}

// ── Create App / Project ─────────────────────────────────────────────

/**
 * Error codes returned by the wizard proxy `POST /projects` endpoint.
 * Match the contract defined with the backend agent.
 *
 * `IDEMPOTENCY_CONFLICT` is the wizard-side mapping for a proxy 409 with
 * code `IDEMPOTENCY_KEY_IN_USE` — the proxy emits it when a concurrent
 * request with the same `Idempotency-Key` is already in flight. Distinct
 * from `NAME_TAKEN` (which is a permanent collision the user fixes by
 * picking a new name); a concurrent-idempotency conflict resolves on its
 * own once the in-flight request finishes.
 */
export type CreateProjectErrorCode =
  | 'NAME_TAKEN'
  | 'QUOTA_REACHED'
  | 'FORBIDDEN'
  | 'INVALID_REQUEST'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INTERNAL';

const CreateProjectSuccessSchema = z.object({
  appId: z.string(),
  apiKey: z.string(),
  name: z.string(),
});

const CreateProjectErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      'NAME_TAKEN',
      'QUOTA_REACHED',
      'FORBIDDEN',
      'INVALID_REQUEST',
      // Wire code emitted by the wizard-proxy. Mapped to
      // `IDEMPOTENCY_CONFLICT` on the wizard side via
      // `mapBackendCreateProjectErrorCode` below so the rest of the
      // wizard can branch on the user-facing taxonomy.
      'IDEMPOTENCY_KEY_IN_USE',
      'INTERNAL',
    ]),
    message: z.string(),
  }),
});

/**
 * Map a wire-level error code returned by the wizard-proxy to the
 * wizard-side {@link CreateProjectErrorCode}. The proxy and the wizard
 * share most names; the only divergence is `IDEMPOTENCY_KEY_IN_USE` →
 * `IDEMPOTENCY_CONFLICT`, which keeps the wizard taxonomy focused on
 * what the user / orchestrator should do (retry shortly) rather than the
 * underlying mechanism. Exported for unit testing.
 */
export function mapBackendCreateProjectErrorCode(
  wireCode: string,
): CreateProjectErrorCode {
  if (wireCode === 'IDEMPOTENCY_KEY_IN_USE') return 'IDEMPOTENCY_CONFLICT';
  switch (wireCode) {
    case 'NAME_TAKEN':
    case 'QUOTA_REACHED':
    case 'FORBIDDEN':
    case 'INVALID_REQUEST':
    case 'INTERNAL':
      return wireCode;
    default:
      // Forward-compat: an unknown code from a newer proxy build is
      // surfaced as INTERNAL so callers' switch statements stay total.
      return 'INTERNAL';
  }
}

export interface CreateProjectResult {
  appId: string;
  apiKey: string;
  name: string;
}

/**
 * Parse a `Retry-After` header into milliseconds. RFC 7231 §7.1.3 allows two
 * forms: a non-negative number of seconds, or an HTTP-date. Returns `null`
 * for missing / malformed values, `0` for HTTP-dates already in the past,
 * and clamps absurdly large values to `RETRY_AFTER_MAX_MS` so a misbehaving
 * gateway can't hang the wizard for an hour.
 *
 * Exported for unit testing — not used outside this module.
 */
export function parseRetryAfterMs(
  raw: string | undefined | null,
  now: () => number = Date.now,
): number | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === '') return null;

  // delta-seconds form (non-negative integer of seconds).
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return clampRetryAfter(seconds * 1000);
  }

  // HTTP-date form. `Date.parse` accepts RFC 1123 / 850 / ISO 8601 — covers
  // every shape gateways realistically emit.
  const epoch = Date.parse(trimmed);
  if (!Number.isFinite(epoch)) return null;
  const delta = epoch - now();
  if (delta <= 0) return 0;
  return clampRetryAfter(delta);
}

const RETRY_AFTER_MAX_MS = 5 * 60 * 1000;

function clampRetryAfter(ms: number): number {
  if (ms < 0) return 0;
  if (ms > RETRY_AFTER_MAX_MS) return RETRY_AFTER_MAX_MS;
  return ms;
}

/**
 * Build user-facing copy for a 429 / 503 response. When the upstream
 * supplied a `Retry-After` hint we surface the wait so the user sees a
 * concrete delay rather than the previous static "wait a moment" line.
 */
function rateLimitedMessage(
  retryAfterMs: number | null,
  context: string,
): string {
  if (retryAfterMs == null) {
    return `Rate limited while ${context}. Please wait a moment and retry.`;
  }
  // Round up — undershooting the server's hint just bounces the next
  // retry; overshooting by ≤1s is harmless.
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return `Rate limited while ${context}. Retrying in ${seconds}s…`;
}

/**
 * Pull `Retry-After` out of an axios response. Header keys are lowercased
 * by axios, but we still walk case-insensitively for defensive correctness
 * (some HTTP/2 stacks preserve original casing). Multi-value arrays are
 * narrowed to the first non-empty entry.
 */
function extractRetryAfterHeader(
  headers: Record<string, unknown> | undefined,
): string | null {
  if (!headers) return null;
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== 'retry-after') continue;
    const v: unknown = headers[key];
    if (typeof v === 'string' && v.trim() !== '') return v;
    if (Array.isArray(v)) {
      const first: unknown = v.find(
        (s: unknown) => typeof s === 'string' && s.trim() !== '',
      );
      if (typeof first === 'string') return first;
    }
  }
  return null;
}

function fallbackCreateProjectErrorForStatus(
  status: number,
  url: string,
  retryAfterMs: number | null = null,
): ApiError {
  // If the backend error body is unavailable or malformed, preserve the
  // HTTP-specific meaning so callers don't receive a vague generic error.
  if (status === 400) {
    return new ApiError(
      'Invalid request while creating project',
      status,
      url,
      'INVALID_REQUEST',
    );
  }
  if (status === 402) {
    return new ApiError(
      'Your org has reached its project quota. Create one in Amplitude settings and try again.',
      status,
      url,
      'QUOTA_REACHED',
    );
  }
  if (status === 403) {
    return new ApiError(
      "You don't have permission to create projects in this org.",
      status,
      url,
      'FORBIDDEN',
    );
  }
  if (status === 409) {
    // 409 has TWO meanings on this endpoint: a permanent name collision
    // (NAME_TAKEN, user fixes by picking a new name) or a transient
    // concurrent-request collision (IDEMPOTENCY_CONFLICT, user fixes by
    // retrying). The structured error body distinguishes them — but if
    // we're in the fallback path, that body was unavailable or malformed
    // and we genuinely don't know which one it is.
    //
    // Default to the retryable interpretation. If it was actually a name
    // collision, the retry hits 409 again (this time hopefully with a
    // parseable body) and the user gets the right "pick a new name"
    // message. The opposite default would silently send users to fix a
    // real-but-transient problem with the wrong action.
    return new ApiError(
      'Conflict while creating project. Please retry in a moment.',
      status,
      url,
      'INTERNAL',
    );
  }
  // 429 is the canonical rate-limit. 503 also surfaces Retry-After when
  // the upstream is in a brief overload window — the proxy strips
  // Retry-After when remapping 503 → 502 (#114018), so by the time we see
  // a 503 here, it's a true downstream "back off" signal worth honoring.
  if (status === 429 || status === 503) {
    return new ApiError(
      rateLimitedMessage(retryAfterMs, 'creating project'),
      status,
      url,
      'INTERNAL',
    );
  }
  return new ApiError(
    `Failed to create project (HTTP ${status})`,
    status,
    url,
    'INTERNAL',
  );
}

/** Max project-name length accepted by the backend (inclusive). */
export const PROJECT_NAME_MAX_LENGTH = 255;

/**
 * Shape of validation errors returned by `validateProjectName`. Null = ok.
 * Callers surface the human-readable `message` inline in the UI.
 */
export interface ProjectNameValidationIssue {
  code: 'empty' | 'too_long' | 'control_chars';
  message: string;
}

/**
 * Local-only validation for a project name. Mirrors the backend rules
 * (1–255 chars trimmed, no control chars) so the UI can reject bad input
 * without a round-trip.
 */
export function validateProjectName(
  name: string,
): ProjectNameValidationIssue | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { code: 'empty', message: 'Project name cannot be empty.' };
  }
  if (trimmed.length > PROJECT_NAME_MAX_LENGTH) {
    return {
      code: 'too_long',
      message: `Project name must be ${PROJECT_NAME_MAX_LENGTH} characters or fewer.`,
    };
  }
  // Reject ASCII control characters (C0 + DEL) — names are shown in UI and URLs.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    return {
      code: 'control_chars',
      message: 'Project name cannot contain control characters.',
    };
  }
  return null;
}

/**
 * Derive the wizard proxy base URL (e.g. `https://core.amplitude.com/wizard`)
 * for the Amplitude data API surface — used by `/v1/projects` (project
 * creation) and `/v1/planned-events` (taxonomy ingestion).
 *
 * This is a SEPARATE surface from the LLM proxy at `wizard.amplitude.com`:
 *
 *   - LLM transport (Claude Agent SDK + AI SDK) → `wizard.amplitude.com/web-api/wizard`
 *     resolved via `getLlmGatewayUrlFromHost` in `utils/urls.ts`.
 *   - Amplitude data API (project creation, planned events) → this function,
 *     `core.amplitude.com/wizard` (US) or `core.eu.amplitude.com/wizard` (EU).
 *
 * Don't conflate them — the data API is region-pinned and validates OAuth
 * tokens against Hydra introspection; the LLM proxy is global.
 *
 * Resolution precedence (first match wins):
 *   1. `WIZARD_PROXY_BASE_URL` — full URL override for tests / dev that need
 *      to point both write paths at a local proxy. Uses a distinct env var
 *      from `WIZARD_LLM_PROXY_URL` so the two surfaces can be redirected
 *      independently.
 *   2. Region-derived: EU → `core.eu.amplitude.com/wizard`,
 *      US → `core.amplitude.com/wizard`.
 *
 * Exported so callers + tests can assert the exact endpoint.
 */
export function getWizardProxyBase(zone: AmplitudeZone): string {
  const override = process.env.WIZARD_PROXY_BASE_URL?.trim();
  if (override) {
    return override.replace(/\/v1\/messages\/?$/, '').replace(/\/$/, '');
  }
  if (zone === 'eu') {
    return 'https://core.eu.amplitude.com/wizard';
  }
  return 'https://core.amplitude.com/wizard';
}

/**
 * Create a new Amplitude analytics project (app) in the given org via the
 * wizard proxy.
 *
 * - Expects an OAuth *access token* (not the id_token) — sent as
 *   `Authorization: Bearer <token>`. The wizard-proxy validates it
 *   against Hydra introspection, which only accepts access tokens.
 * - Errors from the backend are surfaced as `ApiError` with `code` set to one
 *   of `CreateProjectErrorCode` so callers can branch (NAME_TAKEN → retry,
 *   QUOTA_REACHED → fallback, etc.).
 *
 * `idempotencyKey` MUST be a UUID v4 — the wizard-proxy validates the
 * header value with a UUID regex (`extractIdempotencyKey`). Generate one
 * per **logical** create-project attempt and reuse it on retries so a
 * network blip in the middle of a successful create doesn't double-create
 * the project. Callers should source the key from session state, not
 * regenerate per HTTP retry.
 *
 * Returns `{ appId, apiKey, name }` on success. `apiKey` is sensitive — never
 * log it, and redact it from any analytics/NDJSON output.
 */
export async function createAmplitudeApp(
  accessToken: string,
  zone: AmplitudeZone,
  input: {
    orgId: string;
    name: string;
    description?: string;
    /**
     * UUID v4 used to dedupe a successful project-create against retries.
     * Optional today (older proxy builds ignore the header) but strongly
     * recommended — generate once per logical attempt and persist on
     * session state so a retry after a 5xx / connection blip resolves
     * to the same project rather than creating a duplicate.
     */
    idempotencyKey?: string;
  },
): Promise<CreateProjectResult> {
  const base = getWizardProxyBase(zone);
  const url = `${base}/projects`;

  // Validate locally first so we fail fast and don't hit the network with a
  // payload the backend will reject.
  const issue = validateProjectName(input.name);
  if (issue) {
    throw new ApiError(issue.message, 400, url, 'INVALID_REQUEST');
  }
  if (!input.orgId || input.orgId.trim() === '') {
    throw new ApiError('orgId is required', 400, url, 'INVALID_REQUEST');
  }

  // Single-shot retry on a transient 401. Looping past one retry hits the
  // proxy's 30s negative-cache for failed token introspections (#114330) —
  // additional attempts return fast 401s with no recovery. One retry is
  // enough to ride through a token-refresh / clock-skew blip without
  // burning the negative-cache window.
  const MAX_AUTH_RETRIES = 1;
  let authAttempt = 0;
  for (;;) {
    try {
      const response = await apiClient.post(
        url,
        {
          orgId: input.orgId,
          name: input.name.trim(),
          // Only send description when provided to keep the payload minimal.
          ...(input.description ? { description: input.description } : {}),
        },
        {
          headers: {
            // The wizard-proxy auth middleware introspects via Hydra, which
            // only accepts OAuth access tokens (not id_tokens), sent with
            // the `Bearer ` prefix.
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': WIZARD_USER_AGENT,
            // Only attach the header when the caller threaded a key through
            // — older proxy builds ignore unknown headers, but omitting it
            // entirely keeps the wire shape minimal for diff inspection.
            ...(input.idempotencyKey
              ? { 'Idempotency-Key': input.idempotencyKey }
              : {}),
          },
          timeout: 20_000,
        },
      );

      const parsed = CreateProjectSuccessSchema.parse(response.data);
      // Best-effort analytics — `apiKey` intentionally omitted so it never
      // leaves this function in plaintext.
      analytics.wizardCapture('Project Created', {
        source: 'wizard_cli',
        app_id: parsed.appId,
        zone,
        org_id: input.orgId,
      });
      return parsed;
    } catch (error) {
      // Re-throw our own ApiError instances untouched.
      if (error instanceof ApiError) {
        analytics.captureException(error, { endpoint: url, code: error.code });
        throw error;
      }

      // Axios errors include non-2xx responses and network failures.
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        // One-shot retry on 401 — see comment on `MAX_AUTH_RETRIES`.
        if (status === 401 && authAttempt < MAX_AUTH_RETRIES) {
          authAttempt++;
          logToFile('createAmplitudeApp: 401 — retrying once');
          continue;
        }
        if (status) {
          const retryAfterMs = parseRetryAfterMs(
            extractRetryAfterHeader(
              error.response?.headers as Record<string, unknown> | undefined,
            ),
          );
          // Preferred path: parse the backend's structured error payload.
          const errBody = CreateProjectErrorSchema.safeParse(
            error.response?.data,
          );
          if (errBody.success) {
            const wireCode = errBody.data.error.code;
            const code = mapBackendCreateProjectErrorCode(wireCode);
            // Two message overrides on the structured-error path:
            //   1. IDEMPOTENCY_KEY_IN_USE — the proxy's wire message is
            //      mechanism-focused; we surface the recovery action.
            //   2. 429/503 with Retry-After — replace the proxy's generic
            //      "rate limited" line with a concrete delay.
            // The two cases don't overlap in practice (a proxy
            // IDEMPOTENCY_KEY_IN_USE is always 409, never 429/503).
            const baseMessage =
              wireCode === 'IDEMPOTENCY_KEY_IN_USE'
                ? 'A project with this idempotency key is being created concurrently. Please retry in a moment.'
                : errBody.data.error.message;
            const finalMessage =
              (status === 429 || status === 503) && retryAfterMs !== null
                ? rateLimitedMessage(retryAfterMs, 'creating project')
                : baseMessage;
            const apiError = new ApiError(finalMessage, status, url, code);
            analytics.captureException(apiError, { endpoint: url, code });
            throw apiError;
          }

          // If the payload shape is unexpected, preserve HTTP semantics (e.g. 429).
          const apiError = fallbackCreateProjectErrorForStatus(
            status,
            url,
            retryAfterMs,
          );
          analytics.captureException(apiError, {
            endpoint: url,
            code: apiError.code,
          });
          throw apiError;
        }

        // Network failures (DNS, timeout, reset, etc.) have no HTTP response.
        const apiError = new ApiError(
          error.message || 'Network error creating project',
          undefined,
          url,
          'INTERNAL',
        );
        analytics.captureException(apiError, {
          endpoint: url,
          code: 'INTERNAL',
        });
        throw apiError;
      }

      if (error instanceof z.ZodError) {
        const apiError = new ApiError(
          'Invalid response from create-project endpoint',
          undefined,
          url,
          'INTERNAL',
        );
        analytics.captureException(apiError, {
          endpoint: url,
          code: 'INTERNAL',
        });
        throw apiError;
      }

      const apiError = new ApiError(
        `Unexpected error creating project: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        undefined,
        url,
        'INTERNAL',
      );
      analytics.captureException(apiError, {
        endpoint: url,
        code: 'INTERNAL',
      });
      throw apiError;
    }
  }
}

// ── Branches ──────────────────────────────────────────────────────────────

const BranchesSchema = z.object({
  data: z.object({
    orgs: z.array(
      z.object({
        workspaces: z.array(
          z.object({
            branches: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                default: z.boolean(),
                currentVersionId: z.string(),
              }),
            ),
          }),
        ),
      }),
    ),
  }),
});

export type AmplitudeBranch = {
  id: string;
  name: string;
  default: boolean;
  currentVersionId: string;
};

const BRANCHES_QUERY = `
query branches($orgId: ID!, $projectId: ID!) {
  orgs(id: $orgId) {
    workspaces(id: $projectId) {
      branches {
        id
        name
        default
        currentVersionId
      }
    }
  }
}`;

/** Fetches branches for a project. */
export async function fetchBranches(
  idToken: string,
  zone: AmplitudeZone,
  orgId: string,
  projectId: string,
): Promise<AmplitudeBranch[]> {
  const { dataApiUrl } = AMPLITUDE_ZONE_SETTINGS[zone];
  try {
    const response = await apiClient.post(
      dataApiUrl,
      { query: BRANCHES_QUERY, variables: { orgId, projectId } },
      {
        headers: {
          Authorization: idToken,
          'Content-Type': 'application/json',
          'User-Agent': WIZARD_USER_AGENT,
        },
      },
    );
    const parsed = BranchesSchema.parse(response.data);
    return parsed.data.orgs[0]?.workspaces[0]?.branches ?? [];
  } catch (error) {
    const apiError = handleApiError(error, 'fetch branches');
    analytics.captureException(apiError, { endpoint: dataApiUrl });
    throw apiError;
  }
}

// ── Project event types ──────────────────────────────────────────────────

const ProjectEventsSchema = z.object({
  data: z.object({
    orgs: z.array(
      z.object({
        workspaces: z.array(
          z.object({
            branches: z.array(
              z.object({
                versions: z.array(
                  z.object({
                    events: z.array(
                      z.object({ id: z.string(), name: z.string() }),
                    ),
                  }),
                ),
              }),
            ),
          }),
        ),
      }),
    ),
  }),
});

const PROJECT_EVENTS_QUERY = `
query projectEvents($orgId: ID!, $projectId: ID!, $branchId: ID!, $versionId: ID!) {
  orgs(id: $orgId) {
    workspaces(id: $projectId) {
      branches(id: $branchId) {
        versions(id: $versionId) {
          events { id name }
        }
      }
    }
  }
}`;

/**
 * Fetches the event type names cataloged in the default branch of a project.
 * Returns an empty array if the project has no events or the query fails.
 */
export async function fetchProjectEventTypes(
  idToken: string,
  zone: AmplitudeZone,
  orgId: string,
  projectId: string,
): Promise<string[]> {
  const { dataApiUrl } = AMPLITUDE_ZONE_SETTINGS[zone];
  try {
    // Step 1: get default branch + its current version
    const branches = await fetchBranches(idToken, zone, orgId, projectId);
    const defaultBranch = branches.find((b) => b.default) ?? branches[0];
    if (!defaultBranch) return [];

    // Step 2: fetch events for that version
    const response = await apiClient.post(
      dataApiUrl,
      {
        query: PROJECT_EVENTS_QUERY,
        variables: {
          orgId,
          projectId,
          branchId: defaultBranch.id,
          versionId: defaultBranch.currentVersionId,
        },
      },
      {
        headers: {
          Authorization: idToken,
          'Content-Type': 'application/json',
          'User-Agent': WIZARD_USER_AGENT,
        },
      },
    );
    const parsed = ProjectEventsSchema.parse(response.data);
    return (
      parsed.data.orgs[0]?.workspaces[0]?.branches[0]?.versions[0]?.events.map(
        (e) => e.name,
      ) ?? []
    );
  } catch {
    return [];
  }
}

// ── Owned dashboards ──────────────────────────────────────────────────────────

const OwnedDashboardsSchema = z.object({
  data: z.object({
    ownedDashboards: z.array(
      z.object({
        id: z.string(),
        chartIds: z.array(z.string()),
      }),
    ),
  }),
});

const OWNED_DASHBOARDS_QUERY = `
query OwnedDashboards {
  ownedDashboards {
    id
    chartIds
  }
}`;

/**
 * Checks whether the authenticated user has any charts or dashboards in their org.
 * Uses the App API org-scoped GraphQL endpoint.
 *
 * Detection is org-scoped — App API has no project-level chart/dashboard listing
 * API. For a typical new-project user this is equivalent to project-scoped.
 *
 * Returns { hasCharts: false, hasDashboards: false } on any error so the
 * checklist falls back to the default empty state rather than crashing.
 */
export async function fetchOwnedDashboards(
  accessToken: string,
  zone: AmplitudeZone,
  orgId: string,
): Promise<{ hasCharts: boolean; hasDashboards: boolean }> {
  const url = appApiUrl(zone, orgId, 'OwnedDashboards');
  try {
    const response = await apiClient.post(
      url,
      { query: OWNED_DASHBOARDS_QUERY },
      {
        headers: {
          'x-amp-authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': WIZARD_USER_AGENT,
        },
      },
    );
    const parsed = OwnedDashboardsSchema.parse(response.data);
    const dashboards = parsed.data.ownedDashboards;
    return {
      hasDashboards: dashboards.length > 0,
      hasCharts: dashboards.some((d) => d.chartIds.length > 0),
    };
  } catch {
    return { hasCharts: false, hasDashboards: false };
  }
}

// ── Sources ───────────────────────────────────────────────────────────────

const SourcesSchema = z.object({
  data: z.object({
    orgs: z.array(
      z.object({
        workspaces: z.array(
          z.object({
            branches: z.array(
              z.object({
                versions: z.array(
                  z.object({
                    id: z.string(),
                    sources: z.array(
                      z.object({
                        id: z.string(),
                        name: z.string(),
                        runtime: z
                          .object({
                            id: z.string(),
                            platformId: z.string(),
                            platformName: z.string(),
                            languageId: z.string(),
                            languageName: z.string(),
                          })
                          .nullable(),
                        destinations: z.array(
                          z.object({ name: z.string(), serviceId: z.string() }),
                        ),
                      }),
                    ),
                  }),
                ),
              }),
            ),
          }),
        ),
      }),
    ),
  }),
});

export type AmplitudeSource = {
  id: string;
  name: string;
  runtime: {
    id: string;
    platformId: string;
    platformName: string;
    languageId: string;
    languageName: string;
  } | null;
  destinations: Array<{ name: string; serviceId: string }>;
};

const SOURCES_QUERY = `
query sources($orgId: ID!, $projectId: ID!, $branchId: ID!, $versionId: ID!) {
  orgs(id: $orgId) {
    workspaces(id: $projectId) {
      branches(id: $branchId) {
        versions(id: $versionId) {
          id
          sources {
            id
            name
            runtime {
              id
              platformId
              platformName
              languageId
              languageName
            }
            destinations { name serviceId }
          }
        }
      }
    }
  }
}`;

/** Fetches sources for a specific branch version. */
export async function fetchSources(
  idToken: string,
  zone: AmplitudeZone,
  orgId: string,
  projectId: string,
  branchId: string,
  versionId: string,
): Promise<AmplitudeSource[]> {
  const { dataApiUrl } = AMPLITUDE_ZONE_SETTINGS[zone];
  try {
    const response = await apiClient.post(
      dataApiUrl,
      {
        query: SOURCES_QUERY,
        variables: { orgId, projectId, branchId, versionId },
      },
      {
        headers: {
          Authorization: idToken,
          'Content-Type': 'application/json',
          'User-Agent': WIZARD_USER_AGENT,
        },
      },
    );
    const parsed = SourcesSchema.parse(response.data);
    return (
      parsed.data.orgs[0]?.workspaces[0]?.branches[0]?.versions[0]?.sources ??
      []
    );
  } catch (error) {
    const apiError = handleApiError(error, 'fetch sources');
    analytics.captureException(apiError, { endpoint: dataApiUrl });
    throw apiError;
  }
}

// ── MCP-based event ingestion check ──────────────────────────────────────────

export interface McpUser {
  /** Amplitude's internal ID (always present) */
  amplitudeId: string;
  /** App-assigned user ID if setUserId() was called, otherwise null */
  userId: string | null;
}

export interface McpEventsResult {
  hasEvents: boolean;
  /** Kept for API compatibility — always empty (query_dataset was removed from MCP server) */
  csvRows: unknown[][];
  /** Active event names from get_events (isActive=true), up to 10 */
  activeEventNames: string[];
  /** Recent users who fired events, up to 5 */
  activeUsers: McpUser[];
}

/**
 * Checks whether the project has received any events via the Amplitude MCP server.
 * Uses get_users with `_all` as the primary signal (userCount > 0 → events exist),
 * then fetches get_events for display names.
 *
 * Falls back to a Claude agent with the Amplitude MCP configured if the direct
 * HTTP call fails, so the check survives MCP API drift.
 *
 * Requires the numeric Amplitude app ID (from project.environments[].app.id),
 * not the project UUID. The downstream Amplitude MCP tool API still accepts
 * this as a `projectId` parameter (external contract we don't control).
 * Returns false on any error so callers can fall through.
 */
export async function fetchHasAnyEventsMcp(
  accessToken: string,
  appId: string,
  /**
   * Optional abort signal — propagated to the underlying MCP fetch so the
   * caller can cancel an in-flight ingestion poll on shutdown / Ctrl+C
   * instead of letting it run to completion in the background.
   */
  abortSignal?: AbortSignal,
): Promise<McpEventsResult> {
  const NONE: McpEventsResult = {
    hasEvents: false,
    csvRows: [],
    activeEventNames: [],
    activeUsers: [],
  };

  const result = await callAmplitudeMcp<McpEventsResult>({
    accessToken,
    abortSignal,
    label: 'fetchHasAnyEventsMcp',

    direct: async (callTool) => {
      // get_users with _all — primary signal for whether any events have been received.
      // '_all' covers every event type without requiring taxonomy setup.
      // metadata.userCount > 0 means at least one device has sent events to this app.
      // NOTE: MCP tool param name is `projectId` (their API) — we pass our appId.
      const usersText = await callTool(1, 'get_users', {
        projectId: appId,
        event: { event_type: '_all', filters: [] },
        limit: 5,
      });

      if (!usersText) {
        logToFile('[MCP] get_users: no text in response');
        return null;
      }

      let activeUsers: McpUser[];
      let hasEvents: boolean;
      try {
        const parsed = JSON.parse(usersText) as {
          users?: Array<{
            amplitudeId?: string;
            amplitude_id?: string;
            user_id?: string | null;
          }>;
          metadata?: { userCount?: number };
        };
        const userCount =
          parsed.metadata?.userCount ?? parsed.users?.length ?? 0;
        hasEvents = userCount > 0;
        activeUsers = (parsed.users ?? [])
          .filter((u) => u.amplitudeId ?? u.amplitude_id)
          .map((u) => ({
            amplitudeId: (u.amplitudeId ?? u.amplitude_id) as string,
            userId: u.user_id ?? null,
          }))
          .slice(0, 5);
        logToFile(
          `[MCP] get_users: userCount=${userCount}, hasEvents=${hasEvents}`,
        );
      } catch (parseErr) {
        logToFile(
          `[MCP] get_users parse error: ${
            parseErr instanceof Error ? parseErr.message : String(parseErr)
          }`,
        );
        return null;
      }

      if (!hasEvents) return NONE;

      // get_events — fetch active event names for the celebration display.
      // isActive=true means events arrived within ~30 days.
      const eventsText = await callTool(2, 'get_events', {
        projectId: appId,
        limit: 10,
      });
      let activeEventNames: string[] = [];
      if (eventsText) {
        try {
          const parsed = JSON.parse(eventsText) as {
            events?: Array<{
              name?: string;
              isActive?: boolean;
              isHidden?: boolean;
              isDeleted?: boolean;
            }>;
          };
          activeEventNames = (parsed.events ?? [])
            .filter((e) => e.isActive && !e.isHidden && !e.isDeleted && e.name)
            .map((e) => e.name as string)
            .slice(0, 10);
          logToFile(
            `[MCP] get_events: ${activeEventNames.length} active events`,
          );
        } catch (parseErr) {
          logToFile(
            `[MCP] get_events parse error: ${
              parseErr instanceof Error ? parseErr.message : String(parseErr)
            }`,
          );
        }
      }

      return { hasEvents: true, csvRows: [], activeEventNames, activeUsers };
    },

    agentPrompt: `Use the Amplitude MCP to check whether app ${appId} has received any events.
Call get_users with event_type "_all" and limit 5. If userCount > 0, also call get_events with limit 10.
Respond with JSON only — no prose, no markdown fences:
{"hasEvents":true/false,"activeEventNames":["..."],"activeUsers":[{"amplitudeId":"...","userId":"..."}]}`,

    parseAgent: (text) => {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return null;
      try {
        const parsed = JSON.parse(match[0]) as {
          hasEvents?: boolean;
          activeEventNames?: string[];
          activeUsers?: Array<{
            amplitudeId?: string;
            userId?: string | null;
          }>;
        };
        return {
          hasEvents: parsed.hasEvents ?? false,
          csvRows: [],
          activeEventNames: parsed.activeEventNames ?? [],
          activeUsers: (parsed.activeUsers ?? []).map((u) => ({
            amplitudeId: u.amplitudeId ?? '',
            userId: u.userId ?? null,
          })),
        };
      } catch {
        return null;
      }
    },
  });

  return result ?? NONE;
}

// ── Project activation status ──────────────────────────────────────────────

const ActivationStatusSchema = z.object({
  data: z.object({
    hasAnyDefaultEventTrackingSourceAndEvents: z.object({
      hasDetSource: z.boolean(),
      hasPageViewedEvent: z.boolean(),
      hasSessionStartEvent: z.boolean(),
      hasSessionEndEvent: z.boolean(),
    }),
  }),
});

export type ProjectActivationStatus = {
  /** SDK/snippet has been installed (default event tracking source detected) */
  hasDetSource: boolean;
  hasPageViewedEvent: boolean;
  hasSessionStartEvent: boolean;
  hasSessionEndEvent: boolean;
  /** True if at least one event type has been ingested */
  hasAnyEvents: boolean;
};

const ACTIVATION_STATUS_QUERY = `
query hasAnyDefaultEventTrackingSourceAndEvents($appId: ID!) {
  hasAnyDefaultEventTrackingSourceAndEvents(appId: $appId) {
    hasDetSource
    hasPageViewedEvent
    hasSessionStartEvent
    hasSessionEndEvent
  }
}`;

/**
 * Checks whether an Amplitude project has ingested any events and whether
 * the SDK snippet is configured.
 *
 * Always routes to App API (the main Amplitude app GraphQL server) at
 * /t/graphql/org/:orgId using a Bearer access_token.
 */
export async function fetchProjectActivationStatus(opts: {
  accessToken: string;
  zone: AmplitudeZone;
  appId: number | string;
  orgId: string;
}): Promise<ProjectActivationStatus> {
  const { accessToken, zone, appId, orgId } = opts;
  const url = appApiUrl(
    zone,
    orgId,
    'hasAnyDefaultEventTrackingSourceAndEvents',
  );
  try {
    const response = await apiClient.post(
      url,
      { query: ACTIVATION_STATUS_QUERY, variables: { appId: String(appId) } },
      {
        headers: {
          'x-amp-authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': WIZARD_USER_AGENT,
        },
      },
    );
    const parsed = ActivationStatusSchema.parse(response.data);
    const s = parsed.data.hasAnyDefaultEventTrackingSourceAndEvents;
    return {
      ...s,
      hasAnyEvents:
        s.hasPageViewedEvent || s.hasSessionStartEvent || s.hasSessionEndEvent,
    };
  } catch (error) {
    const apiError = handleApiError(error, 'fetch project activation status');
    analytics.captureException(apiError, { endpoint: url });
    throw apiError;
  }
}

// ── Slack install URL ─────────────────────────────────────────────────────

const SlackInstallUrlSchema = z.object({
  data: z.object({
    slackInstallUrl: z.object({
      installUrl: z.string().url(),
    }),
  }),
});

const SLACK_INSTALL_URL_QUERY = `
query SlackInstallUrl($action: SlackInstallUrlAction!, $originalPath: String) {
  slackInstallUrl(action: $action, originalPath: $originalPath) {
    installUrl
  }
}`;

/**
 * Fetches the direct Slack OAuth install URL from App API.
 * This lets the wizard open the Slack authorization page directly instead of
 * routing through Amplitude Settings.
 *
 * Returns `null` on any error so callers can fall back to the settings page.
 */
export async function fetchSlackInstallUrl(
  accessToken: string,
  zone: AmplitudeZone,
  orgId: string,
  originalPath: string,
): Promise<string | null> {
  const url = appApiUrl(zone, orgId, 'SlackInstallUrl');
  try {
    const response = await apiClient.post(
      url,
      {
        query: SLACK_INSTALL_URL_QUERY,
        variables: { action: 'profile', originalPath },
      },
      {
        headers: {
          'x-amp-authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': WIZARD_USER_AGENT,
        },
        timeout: 10_000,
      },
    );
    logToFile(
      `[fetchSlackInstallUrl] response status=${
        response.status
      } data=${JSON.stringify(response.data)}`,
    );
    const parsed = SlackInstallUrlSchema.parse(response.data);
    return parsed.data.slackInstallUrl.installUrl;
  } catch (err) {
    const detail = axios.isAxiosError(err)
      ? `status=${err.response?.status} data=${JSON.stringify(
          err.response?.data,
        )}`
      : err instanceof Error
      ? err.message
      : String(err);
    logToFile(`[fetchSlackInstallUrl] failed: ${detail}`);
    return null;
  }
}

// ── Slack connection status ───────────────────────────────────────────────

const SlackConnectionStatusSchema = z.object({
  data: z.object({
    slackConnectionStatus: z.object({
      isConnected: z.boolean(),
    }),
  }),
});

const SLACK_CONNECTION_STATUS_QUERY = `
query SlackConnectionStatus {
  slackConnectionStatus {
    isConnected
  }
}`;

/**
 * Checks whether the authenticated user already has Slack connected.
 * Returns `null` on any error so callers treat it as unknown.
 */
export async function fetchSlackConnectionStatus(
  accessToken: string,
  zone: AmplitudeZone,
  orgId: string,
): Promise<boolean | null> {
  const url = appApiUrl(zone, orgId, 'SlackConnectionStatus');
  try {
    const response = await apiClient.post(
      url,
      { query: SLACK_CONNECTION_STATUS_QUERY },
      {
        headers: {
          'x-amp-authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': WIZARD_USER_AGENT,
        },
        timeout: 10_000,
      },
    );
    const parsed = SlackConnectionStatusSchema.parse(response.data);
    return parsed.data.slackConnectionStatus.isConnected;
  } catch {
    return null;
  }
}

function handleApiError(error: unknown, operation: string): ApiError {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<{
      errors?: Array<{ message: string }>;
    }>;
    const status = axiosError.response?.status;
    const endpoint = axiosError.config?.url;
    const gqlMessage = axiosError.response?.data?.errors?.[0]?.message;

    if (status === 401)
      return new ApiError(
        `Authentication failed while trying to ${operation}`,
        status,
        endpoint,
      );
    if (status === 403)
      return new ApiError(
        `Access denied while trying to ${operation}`,
        status,
        endpoint,
      );
    const message = gqlMessage ?? `Failed to ${operation}`;
    return new ApiError(message, status, endpoint);
  }

  if (error instanceof z.ZodError) {
    return new ApiError(`Invalid response format while trying to ${operation}`);
  }

  return new ApiError(
    `Unexpected error while trying to ${operation}: ${
      error instanceof Error ? error.message : 'Unknown error'
    }`,
  );
}

// ── Legacy stubs — kept so files referencing the old Amplitude types compile ──

export const ApiUserSchema = z.object({ distinct_id: z.string() });
export const ApiProjectSchema = z.object({
  id: z.number(),
  uuid: z.string(),
  organization: z.string(),
  api_token: z.string(),
  name: z.string(),
});
export type ApiUser = z.infer<typeof ApiUserSchema>;
export type ApiProject = z.infer<typeof ApiProjectSchema>;

/** @deprecated Amplitude stub. Use fetchAmplitudeUser instead. */
// eslint-disable-next-line @typescript-eslint/require-await
export async function fetchUserData(
  _accessToken: string,
  _baseUrl: string,
): Promise<ApiUser> {
  throw new Error(
    'fetchUserData is a Amplitude stub — use fetchAmplitudeUser instead',
  );
}

/** @deprecated Amplitude stub. Use fetchAmplitudeUser instead. */
// eslint-disable-next-line @typescript-eslint/require-await
export async function fetchProjectData(
  _accessToken: string,
  _projectId: number,
  _baseUrl: string,
): Promise<ApiProject> {
  throw new Error(
    'fetchProjectData is a Amplitude stub — use fetchAmplitudeUser instead',
  );
}
