/**
 * Credential resolution — shared between TUI, agent, and CI modes.
 *
 * Reads stored OAuth tokens, refreshes them if needed, fetches the user's
 * org/workspace/environment list, and populates session credentials when
 * possible. When multiple environments exist, populates `pendingOrgs` so
 * the caller (TUI AuthScreen or AgentUI NDJSON prompt) can handle selection.
 */

import type { WizardSession } from './wizard-session';
import type { AmplitudeZone } from './constants';
import { extractProjectId } from './api';

/**
 * Resolve credentials from stored OAuth tokens and environment data.
 *
 * Mutates `session` in place:
 * - Sets `session.credentials` when a single environment or local key is found
 * - Sets `session.pendingOrgs` + `pendingAuthIdToken` + `pendingAuthAccessToken`
 *   when multiple environments exist (caller must handle selection)
 * - Sets `session.apiKeyNotice` when auto-fetch fails
 *
 * Skips entirely when `session.apiKey` is already set (--api-key flag) or
 * `session.credentials` is already populated.
 */
export async function resolveCredentials(
  session: WizardSession,
  options?: {
    /**
     * When true, clears credentials if no org/workspace ID is set.
     * TUI mode uses this so AuthScreen can force selection.
     * Agent/CI mode should set false — a local API key is sufficient.
     */
    requireOrgId?: boolean;
    /** Org name filter (from --org flag). Case-insensitive partial match. */
    org?: string;
    /** Environment name filter (from --env flag). Case-insensitive match. */
    env?: string;
  },
): Promise<void> {
  // Already have credentials (e.g. from --api-key flag)
  if (session.credentials || session.apiKey) return;

  const installDir = session.installDir;

  const [
    { getStoredUser, getStoredToken },
    { readAmpliConfig },
    { getAPIKey },
    { getHostFromRegion },
    { logToFile },
    { persistApiKey, readApiKeyWithSource },
  ] = await Promise.all([
    import('../utils/ampli-settings.js'),
    import('./ampli-config.js'),
    import('../utils/get-api-key.js'),
    import('../utils/urls.js'),
    import('../utils/debug.js'),
    import('../utils/api-key-store.js'),
  ]);

  // Resolve zone from stored user and project config
  const storedUser = getStoredUser();
  const realUser =
    storedUser && storedUser.id !== 'pending' ? storedUser : null;

  if (realUser?.email) {
    session.userEmail = realUser.email;
  }

  const projectConfig = readAmpliConfig(installDir);
  const projectZone = projectConfig.ok ? projectConfig.config.Zone : undefined;

  // Checkpoint region wins (user explicitly changed via /region),
  // then project config, then global user zone.
  const zone =
    (session._restoredFromCheckpoint ? session.region : null) ??
    projectZone ??
    realUser?.zone ??
    null;

  if (zone) {
    session.region = zone;
  }

  // Try to resolve credentials from a stored OAuth token
  if (zone) {
    const storedToken = realUser
      ? getStoredToken(realUser.id, realUser.zone)
      : getStoredToken(undefined, zone);

    if (storedToken) {
      // Silent token refresh
      const { tryRefreshToken } = await import('../utils/token-refresh.js');
      const expiresAtMs = new Date(storedToken.expiresAt).getTime();
      const refreshResult = await tryRefreshToken(
        {
          accessToken: storedToken.accessToken,
          refreshToken: storedToken.refreshToken,
          expiresAt: expiresAtMs,
        },
        zone as AmplitudeZone,
      );
      if (refreshResult) {
        const { storeToken } = await import('../utils/ampli-settings.js');
        if (realUser) {
          storeToken(realUser, {
            ...storedToken,
            accessToken: refreshResult.accessToken,
            expiresAt: new Date(refreshResult.expiresAt).toISOString(),
            // Persist rotated refresh token if the server issued one
            ...(refreshResult.refreshToken
              ? { refreshToken: refreshResult.refreshToken }
              : {}),
          });
        }
        storedToken.accessToken = refreshResult.accessToken;
        if (refreshResult.refreshToken) {
          storedToken.refreshToken = refreshResult.refreshToken;
        }
        logToFile(
          '[credential-resolution] silently refreshed expired access token',
        );
      }

      // Check local storage first — if a key is already persisted
      // for this install dir, use it without fetching user data.
      const localKey = readApiKeyWithSource(installDir);

      if (localKey) {
        logToFile('[credential-resolution] using locally stored API key');
        session.credentials = {
          accessToken: storedToken.accessToken,
          idToken: storedToken.idToken,
          projectApiKey: localKey.key,
          host: getHostFromRegion(zone as AmplitudeZone),
          projectId: 0,
        };
        session.activationLevel = 'none';
        session.projectHasData = false;
      } else {
        // Fetch user data to check how many environments are available.
        const { fetchAmplitudeUser } = await import('./api.js');
        try {
          const userInfo = await fetchAmplitudeUser(
            storedToken.idToken,
            zone as AmplitudeZone,
          );
          const workspaceId = session.selectedWorkspaceId ?? undefined;

          // Find the relevant workspace and its environments
          let envsWithKey: Array<{
            name: string;
            rank: number;
            app: {
              id: string;
              apiKey?: string | null;
            } | null;
          }> = [];
          for (const org of userInfo.orgs) {
            const ws = workspaceId
              ? org.workspaces.find((w) => w.id === workspaceId)
              : org.workspaces[0];
            if (ws?.environments) {
              envsWithKey = ws.environments
                .filter((env) => env.app?.apiKey)
                .sort((a, b) => a.rank - b.rank);
              break;
            }
          }

          // If --env flag was provided, try to match across all orgs/workspaces
          if (options?.env) {
            const envMatch = options.env.toLowerCase();
            const orgFilter = options.org?.toLowerCase();

            for (const org of userInfo.orgs) {
              if (orgFilter && !org.name.toLowerCase().includes(orgFilter)) {
                continue;
              }
              for (const ws of org.workspaces) {
                const matchedEnv = (ws.environments ?? []).find(
                  (e) => e.app?.apiKey && e.name.toLowerCase() === envMatch,
                );
                if (matchedEnv?.app?.apiKey) {
                  const apiKey = matchedEnv.app.apiKey;
                  session.selectedOrgId = org.id;
                  session.selectedOrgName = org.name;
                  session.selectedWorkspaceId = ws.id;
                  session.selectedWorkspaceName = ws.name;
                  session.selectedProjectName = matchedEnv.name;
                  if (!session.userEmail && userInfo.email) {
                    session.userEmail = userInfo.email;
                  }
                  logToFile(
                    `[credential-resolution] --env matched: ${org.name} / ${ws.name} / ${matchedEnv.name}`,
                  );
                  persistApiKey(apiKey, installDir);
                  session.credentials = {
                    accessToken: storedToken.accessToken,
                    idToken: storedToken.idToken,
                    projectApiKey: apiKey,
                    host: getHostFromRegion(zone as AmplitudeZone),
                    projectId: 0,
                  };
                  session.activationLevel = 'none';
                  session.projectHasData = false;
                  break;
                }
              }
              if (session.credentials) break;
            }

            if (!session.credentials) {
              logToFile(
                `[credential-resolution] --env "${options.env}" did not match any environment`,
              );
            }
          } else if (envsWithKey.length === 1) {
            // Single environment — auto-select
            const apiKey = envsWithKey[0].app!.apiKey!;
            session.selectedProjectName = envsWithKey[0].name;

            // Populate org/workspace names
            for (const org of userInfo.orgs) {
              const ws = workspaceId
                ? org.workspaces.find((w) => w.id === workspaceId)
                : org.workspaces[0];
              if (ws?.environments?.some((e) => e.app?.apiKey === apiKey)) {
                session.selectedOrgId = org.id;
                session.selectedOrgName = org.name;
                session.selectedWorkspaceId = ws.id;
                session.selectedWorkspaceName = ws.name;
                break;
              }
            }
            if (!session.userEmail && userInfo.email) {
              session.userEmail = userInfo.email;
            }

            logToFile(
              '[credential-resolution] single environment — auto-selecting API key',
            );
            persistApiKey(apiKey, installDir);
            session.credentials = {
              accessToken: storedToken.accessToken,
              idToken: storedToken.idToken,
              projectApiKey: apiKey,
              host: getHostFromRegion(zone as AmplitudeZone),
              projectId: 0,
            };
            session.activationLevel = 'none';
            session.projectHasData = false;
          } else if (envsWithKey.length > 1) {
            // Multiple environments — defer to caller for selection
            logToFile(
              `[credential-resolution] ${envsWithKey.length} environments found — deferring to project picker`,
            );
            session.pendingOrgs = userInfo.orgs;
            session.pendingAuthIdToken = storedToken.idToken;
            session.pendingAuthAccessToken = storedToken.accessToken;
          } else {
            logToFile(
              '[credential-resolution] no environments with API keys — showing apiKeyNotice',
            );
            session.apiKeyNotice =
              "Your API key couldn't be fetched automatically. " +
              'Only organization admins can access project API keys — ' +
              'if you need one, ask an admin to share it with you.';
          }
        } catch (err) {
          logToFile(
            `[credential-resolution] fetchAmplitudeUser failed: ${
              err instanceof Error ? err.message : 'unknown'
            }`,
          );
          // Fall back to getAPIKey for backward compatibility
          const projectApiKey = await getAPIKey({
            installDir,
            idToken: storedToken.idToken,
            zone: zone as AmplitudeZone,
            workspaceId: session.selectedWorkspaceId ?? undefined,
          });
          if (projectApiKey) {
            persistApiKey(projectApiKey, installDir);
            session.credentials = {
              accessToken: storedToken.accessToken,
              idToken: storedToken.idToken,
              projectApiKey,
              host: getHostFromRegion(zone as AmplitudeZone),
              projectId: 0,
            };
            session.activationLevel = 'none';
            session.projectHasData = false;
          } else {
            session.apiKeyNotice =
              "Your API key couldn't be fetched automatically. " +
              'Only organization admins can access project API keys — ' +
              'if you need one, ask an admin to share it with you.';
          }
        }
      }
    }
  }

  // Pre-populate org/workspace from ampli.json so activation checks
  // have the IDs they need even when the SUSI flow was skipped.
  if (
    !session.selectedOrgId &&
    projectConfig.ok &&
    projectConfig.config.OrgId
  ) {
    session.selectedOrgId = String(projectConfig.config.OrgId);
  }
  if (
    !session.selectedWorkspaceId &&
    projectConfig.ok &&
    projectConfig.config.WorkspaceId
  ) {
    session.selectedWorkspaceId = projectConfig.config.WorkspaceId;
  }

  // Safety check: in TUI mode, clear credentials if no org/workspace ID
  // so AuthScreen can force selection. In agent/CI mode, a local API key
  // is sufficient — skip this check.
  if (
    options?.requireOrgId !== false &&
    session.credentials !== null &&
    !session.selectedOrgId &&
    !session.pendingOrgs
  ) {
    logToFile(
      '[credential-resolution] credentials set but no org/workspace — clearing to force AuthScreen',
    );
    session.credentials = null;
  }
}

/**
 * Resolve environment selection from pendingOrgs.
 *
 * Given a selected org ID, workspace ID, and environment name,
 * populates session.credentials from the matching environment.
 * Returns true if credentials were populated.
 */
export async function resolveEnvironmentSelection(
  session: WizardSession,
  selection: { orgId: string; workspaceId: string; env: string },
): Promise<boolean> {
  if (!session.pendingOrgs) return false;

  const { getHostFromRegion } = await import('../utils/urls.js');
  const { persistApiKey } = await import('../utils/api-key-store.js');
  const { logToFile } = await import('../utils/debug.js');

  const org = session.pendingOrgs.find((o) => o.id === selection.orgId);
  if (!org) {
    logToFile(`[credential-resolution] org not found: ${selection.orgId}`);
    return false;
  }

  const ws = org.workspaces.find((w) => w.id === selection.workspaceId);
  if (!ws) {
    logToFile(
      `[credential-resolution] workspace not found: ${selection.workspaceId}`,
    );
    return false;
  }

  const env = ws.environments?.find(
    (e) => e.name.toLowerCase() === selection.env.toLowerCase(),
  );
  if (!env?.app?.apiKey) {
    logToFile(
      `[credential-resolution] environment not found or has no API key: ${selection.env}`,
    );
    return false;
  }

  const zone = (session.region ?? 'us') as AmplitudeZone;
  const apiKey = env.app.apiKey;

  session.selectedOrgId = org.id;
  session.selectedOrgName = org.name;
  session.selectedWorkspaceId = ws.id;
  session.selectedWorkspaceName = ws.name;
  session.selectedProjectName = env.name;

  // Extract the numeric analytics project ID for MCP-based event detection.
  const projectId = extractProjectId(ws);
  session.selectedProjectId = projectId;

  persistApiKey(apiKey, session.installDir);
  session.credentials = {
    accessToken: session.pendingAuthAccessToken ?? '',
    idToken: session.pendingAuthIdToken ?? undefined,
    projectApiKey: apiKey,
    host: getHostFromRegion(zone),
    projectId: 0,
  };
  session.activationLevel = 'none';
  session.projectHasData = false;

  logToFile(
    `[credential-resolution] resolved environment: ${org.name} / ${ws.name} / ${env.name}`,
  );
  return true;
}
