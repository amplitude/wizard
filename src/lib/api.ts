import axios, { AxiosError } from 'axios';
import { z } from 'zod';
import { analytics } from '../utils/analytics.js';
import {
  AMPLITUDE_ZONE_SETTINGS,
  WIZARD_USER_AGENT,
  type AmplitudeZone,
} from './constants.js';

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
          }),
        ),
      }),
    ),
  }),
});

export type AmplitudeOrg = {
  id: string;
  name: string;
  workspaces: Array<{ id: string; name: string }>;
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
                        runtime: z.object({
                          id: z.string(),
                          platformId: z.string(),
                          platformName: z.string(),
                          languageId: z.string(),
                          languageName: z.string(),
                        }).nullable(),
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
