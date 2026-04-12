/**
 * org-resolution.ts — Pure helpers for matching org/workspace/environment
 * data from the Amplitude GraphQL API response.
 *
 * Extracted from bin.ts so the logic is testable in isolation.
 */

import type { AmplitudeOrg } from './api.js';

/** The fields resolved by the org-matching helpers. */
export interface ResolvedOrgData {
  orgId: string;
  orgName: string;
  workspaceId: string;
  workspaceName: string;
  projectName: string;
}

/**
 * Given the full org hierarchy and a known API key, walk the tree and
 * return the org/workspace/environment that owns that key.
 *
 * Returns `null` when no environment matches.
 */
export function resolveOrgByApiKey(
  orgs: AmplitudeOrg[],
  apiKey: string,
): ResolvedOrgData | null {
  for (const org of orgs) {
    for (const ws of org.workspaces) {
      const env = ws.environments?.find((e) => e.app?.apiKey === apiKey);
      if (env) {
        return {
          orgId: org.id,
          orgName: org.name,
          workspaceId: ws.id,
          workspaceName: ws.name,
          projectName: env.name,
        };
      }
    }
  }
  return null;
}

/** A single environment with a usable API key. */
export interface ResolvedEnv {
  name: string;
  rank: number;
  apiKey: string;
  orgId: string;
  orgName: string;
  workspaceId: string;
  workspaceName: string;
}

/**
 * Given the full org hierarchy and an optional workspace ID filter,
 * return all environments that have a valid API key, sorted by rank
 * (lowest rank = primary environment).
 *
 * When `workspaceId` is provided, only that workspace is searched.
 * Otherwise the first workspace of the first org is used.
 */
export function resolveEnvsWithKey(
  orgs: AmplitudeOrg[],
  workspaceId?: string,
): ResolvedEnv[] {
  for (const org of orgs) {
    const ws = workspaceId
      ? org.workspaces.find((w) => w.id === workspaceId)
      : org.workspaces[0];
    if (ws?.environments) {
      return ws.environments
        .filter((env): env is typeof env & { app: { apiKey: string } } =>
          Boolean(env.app?.apiKey),
        )
        .sort((a, b) => a.rank - b.rank)
        .map((env) => ({
          name: env.name,
          rank: env.rank,
          apiKey: env.app.apiKey,
          orgId: org.id,
          orgName: org.name,
          workspaceId: ws.id,
          workspaceName: ws.name,
        }));
    }
  }
  return [];
}
