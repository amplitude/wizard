import axios, { AxiosError } from 'axios';
import { z } from 'zod';
import { analytics } from '../utils/analytics.js';
import { logToFile } from '../utils/debug.js';
import {
  AMPLITUDE_ZONE_SETTINGS,
  WIZARD_USER_AGENT,
  type AmplitudeZone,
} from './constants.js';

// ── Thunder URL helper ────────────────────────────────────────────────

/**
 * Builds the Thunder GraphQL endpoint for the given zone and orgId.
 * Respects `WIZARD_PROXY_THUNDER_URL` for local development — e.g.
 * `WIZARD_PROXY_THUNDER_URL=http://localhost:3030/` routes Thunder
 * traffic to a local server.
 */
function thunderUrl(zone: AmplitudeZone, orgId: string): string {
  const base =
    process.env.WIZARD_PROXY_THUNDER_URL ??
    AMPLITUDE_ZONE_SETTINGS[zone].appApiUrlBase;
  // Ensure the base ends with /graphql/org/ so we can append orgId.
  const graphqlBase = base.endsWith('/graphql/org/')
    ? base
    : `${base.replace(/\/$/, '')}/graphql/org/`;
  return `${graphqlBase}${orgId}`;
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
  workspaces: Array<{
    id: string;
    name: string;
    environments?: Array<{
      name: string;
      rank: number;
      app: { id: string; apiKey?: string | null } | null;
    }> | null;
  }>;
};

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

class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly endpoint?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Fetches the authenticated user's org/workspace info from Amplitude's Data API.
 * Uses the OAuth id_token as the Authorization header (same as ampli CLI).
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
        workspaces: org.workspaces,
      })),
    };
  } catch (error) {
    const apiError = handleApiError(error, 'fetch Amplitude user data');
    analytics.captureException(apiError, { endpoint: dataApiUrl });
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
query branches($orgId: ID!, $workspaceId: ID!) {
  orgs(id: $orgId) {
    workspaces(id: $workspaceId) {
      branches {
        id
        name
        default
        currentVersionId
      }
    }
  }
}`;

/** Fetches branches for a workspace. */
export async function fetchBranches(
  idToken: string,
  zone: AmplitudeZone,
  orgId: string,
  workspaceId: string,
): Promise<AmplitudeBranch[]> {
  const { dataApiUrl } = AMPLITUDE_ZONE_SETTINGS[zone];
  try {
    const response = await axios.post(
      dataApiUrl,
      { query: BRANCHES_QUERY, variables: { orgId, workspaceId } },
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

// ── Workspace event types ─────────────────────────────────────────────────

const WorkspaceEventsSchema = z.object({
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

const WORKSPACE_EVENTS_QUERY = `
query workspaceEvents($orgId: ID!, $workspaceId: ID!, $branchId: ID!, $versionId: ID!) {
  orgs(id: $orgId) {
    workspaces(id: $workspaceId) {
      branches(id: $branchId) {
        versions(id: $versionId) {
          events { id name }
        }
      }
    }
  }
}`;

/**
 * Fetches the event type names cataloged in the default branch of a workspace.
 * Returns an empty array if the workspace has no events or the query fails.
 */
export async function fetchWorkspaceEventTypes(
  idToken: string,
  zone: AmplitudeZone,
  orgId: string,
  workspaceId: string,
): Promise<string[]> {
  const { dataApiUrl } = AMPLITUDE_ZONE_SETTINGS[zone];
  try {
    // Step 1: get default branch + its current version
    const branches = await fetchBranches(idToken, zone, orgId, workspaceId);
    const defaultBranch = branches.find((b) => b.default) ?? branches[0];
    if (!defaultBranch) return [];

    // Step 2: fetch events for that version
    const response = await axios.post(
      dataApiUrl,
      {
        query: WORKSPACE_EVENTS_QUERY,
        variables: {
          orgId,
          workspaceId,
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
    const parsed = WorkspaceEventsSchema.parse(response.data);
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
 * Uses the Thunder org-scoped GraphQL endpoint.
 *
 * Detection is org-scoped — Thunder has no project-level chart/dashboard listing
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
  const url = thunderUrl(zone, orgId);
  try {
    const response = await axios.post(
      url,
      { query: OWNED_DASHBOARDS_QUERY },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
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
query sources($orgId: ID!, $workspaceId: ID!, $branchId: ID!, $versionId: ID!) {
  orgs(id: $orgId) {
    workspaces(id: $workspaceId) {
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
  workspaceId: string,
  branchId: string,
  versionId: string,
): Promise<AmplitudeSource[]> {
  const { dataApiUrl } = AMPLITUDE_ZONE_SETTINGS[zone];
  try {
    const response = await axios.post(
      dataApiUrl,
      {
        query: SOURCES_QUERY,
        variables: { orgId, workspaceId, branchId, versionId },
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
 * The query lives in Thunder (the main Amplitude app GraphQL server), served
 * at /graphql/org/:orgId.  orgId is required to construct the endpoint URL.
 */
export async function fetchProjectActivationStatus(
  token: string,
  zone: AmplitudeZone,
  appId: number | string,
  orgId?: string | null,
  /** Optional id_token for the Data API fallback path. When omitted, `token` is used. */
  dataApiToken?: string,
): Promise<ProjectActivationStatus> {
  const { dataApiUrl } = AMPLITUDE_ZONE_SETTINGS[zone];
  // Use the Thunder org-scoped endpoint when orgId is available; fall back to
  // the data API (which may not expose this field for all users).
  // Thunder validates access_tokens via Hydra; data API accepts id_tokens.
  const isThunder = !!orgId;
  const url = isThunder ? thunderUrl(zone, orgId) : dataApiUrl;
  try {
    const response = await axios.post(
      url,
      { query: ACTIVATION_STATUS_QUERY, variables: { appId: String(appId) } },
      {
        headers: {
          Authorization: isThunder ? `Bearer ${token}` : dataApiToken ?? token,
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
 * Fetches the direct Slack OAuth install URL from Thunder.
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
  const url = thunderUrl(zone, orgId);
  try {
    const response = await axios.post(
      url,
      {
        query: SLACK_INSTALL_URL_QUERY,
        variables: { action: 'profile', originalPath },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
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
  const url = thunderUrl(zone, orgId);
  try {
    const response = await axios.post(
      url,
      { query: SLACK_CONNECTION_STATUS_QUERY },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
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
