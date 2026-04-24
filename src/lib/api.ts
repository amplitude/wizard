import axios, { AxiosError } from 'axios';
import { z } from 'zod';
import { analytics } from '../utils/analytics.js';
import { logToFile } from '../utils/debug.js';
import {
  AMPLITUDE_ZONE_SETTINGS,
  WIZARD_USER_AGENT,
  type AmplitudeZone,
} from './constants.js';
import { callAmplitudeMcp } from './mcp-with-fallback.js';
import { getHostFromRegion, getLlmGatewayUrlFromHost } from '../utils/urls.js';

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
    const response = await axios.post(
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
 */
export type CreateProjectErrorCode =
  | 'NAME_TAKEN'
  | 'QUOTA_REACHED'
  | 'FORBIDDEN'
  | 'INVALID_REQUEST'
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
      'INTERNAL',
    ]),
    message: z.string(),
  }),
});

export interface CreateProjectResult {
  appId: string;
  apiKey: string;
  name: string;
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
 * from a zone by starting from the API host and stripping any trailing
 * `/v1/messages` suffix the gateway appends for the Claude SDK.
 *
 * Exported so callers + tests can assert the exact endpoint.
 */
export function getWizardProxyBase(zone: AmplitudeZone): string {
  const gateway = getLlmGatewayUrlFromHost(getHostFromRegion(zone));
  // getLlmGatewayUrlFromHost returns the base without `/v1/messages`, but if a
  // WIZARD_LLM_PROXY_URL override includes it we need to strip it so the base
  // stays consistent.
  return gateway.replace(/\/v1\/messages\/?$/, '').replace(/\/$/, '');
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
 * Returns `{ appId, apiKey, name }` on success. `apiKey` is sensitive — never
 * log it, and redact it from any analytics/NDJSON output.
 */
export async function createAmplitudeApp(
  accessToken: string,
  zone: AmplitudeZone,
  input: { orgId: string; name: string; description?: string },
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

  try {
    const response = await axios.post(
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
        },
        // Treat 4xx/5xx as normal responses so we can surface the backend's
        // structured error payload without axios re-wrapping it.
        validateStatus: () => true,
        timeout: 20_000,
      },
    );

    if (response.status >= 200 && response.status < 300) {
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
    }

    // Attempt to parse the structured error body. If it doesn't match the
    // schema, fall through to a generic INTERNAL error so callers still get a
    // usable code.
    const errBody = CreateProjectErrorSchema.safeParse(response.data);
    if (errBody.success) {
      const { code, message } = errBody.data.error;
      throw new ApiError(message, response.status, url, code);
    }

    throw new ApiError(
      `Failed to create project (HTTP ${response.status})`,
      response.status,
      url,
      'INTERNAL',
    );
  } catch (error) {
    // Re-throw our own ApiError instances untouched.
    if (error instanceof ApiError) {
      analytics.captureException(error, { endpoint: url, code: error.code });
      throw error;
    }

    // Axios errors from network failures (DNS, timeout, etc.) — map to INTERNAL.
    if (axios.isAxiosError(error)) {
      const apiError = new ApiError(
        error.message || 'Network error creating project',
        error.response?.status,
        url,
        'INTERNAL',
      );
      analytics.captureException(apiError, { endpoint: url, code: 'INTERNAL' });
      throw apiError;
    }

    if (error instanceof z.ZodError) {
      const apiError = new ApiError(
        'Invalid response from create-project endpoint',
        undefined,
        url,
        'INTERNAL',
      );
      analytics.captureException(apiError, { endpoint: url, code: 'INTERNAL' });
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
    analytics.captureException(apiError, { endpoint: url, code: 'INTERNAL' });
    throw apiError;
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
    const response = await axios.post(
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
    const response = await axios.post(
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
    const response = await axios.post(
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
    const response = await axios.post(
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
): Promise<McpEventsResult> {
  const NONE: McpEventsResult = {
    hasEvents: false,
    csvRows: [],
    activeEventNames: [],
    activeUsers: [],
  };

  const result = await callAmplitudeMcp<McpEventsResult>({
    accessToken,
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
    const response = await axios.post(
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
    const response = await axios.post(
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
    const response = await axios.post(
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
