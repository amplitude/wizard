/**
 * Credential resolution — shared between TUI, agent, and CI modes.
 *
 * Reads stored OAuth tokens, refreshes them if needed, fetches the user's
 * org/project/environment list, and populates session credentials when
 * possible. When multiple environments exist, populates `pendingOrgs` so
 * the caller (TUI AuthScreen or AgentUI NDJSON prompt) can handle selection.
 */

import type { WizardSession } from './wizard-session';
import { toCredentialAppId } from './wizard-session';
import { DEFAULT_AMPLITUDE_ZONE } from './constants';
import { resolveZone } from './zone-resolution';
import { extractAppId } from './api';
import { analytics } from '../utils/analytics';

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
     * When true, clears credentials if no org/project ID is set.
     * TUI mode uses this so AuthScreen can force selection.
     * Agent/CI mode should set false — a local API key is sufficient.
     */
    requireOrgId?: boolean;
    /** Org name filter (from --org flag). Case-insensitive partial match. */
    org?: string;
    /** Environment name filter (from --env flag). Case-insensitive match. */
    env?: string;
    /**
     * Project ID filter (from --project-id flag). Matches project.id
     * exactly. Lets agents disambiguate when multiple projects have
     * environments with the same name. (The backend GraphQL layer still
     * calls this a "workspace" — we expose it as `projectId` to match
     * the rest of the wizard.)
     */
    projectId?: string;
    /**
     * Numeric Amplitude app ID filter (from --app-id flag; --project-id is
     * a legacy alias). Matches environment.app.id exactly. Globally unique
     * — one app ID maps to exactly one (org, project, env) triple.
     */
    appId?: string;
    /**
     * Optional OAuth access token (from AMPLITUDE_TOKEN env var).
     * When provided and a stored session exists, replaces the stored
     * access token. Does NOT bypass the stored idToken/refreshToken —
     * a prior login is still required for agent mode to fetch project
     * API keys.
     */
    accessTokenOverride?: string;
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

  // projectConfig is read here (not inside resolveZone) because later code in
  // this function uses projectConfig.config.OrgId and projectConfig.config.WorkspaceId
  // for org/workspace pre-population. resolveZone reads ampli.json separately;
  // the duplicate read is cheap and keeps the helper pure.
  const projectConfig = readAmpliConfig(installDir);

  // Single source of truth for zone resolution — see src/lib/zone-resolution.ts.
  // No longer mutates session.region: that field represents user intent, not
  // resolved effective zone.
  // readDisk: true — credential resolution runs before the RegionSelect gate;
  // session.region may not be set yet and disk tiers are the authoritative
  // source.
  const zone = resolveZone(session, DEFAULT_AMPLITUDE_ZONE, { readDisk: true });

  // Try to resolve credentials from a stored OAuth token.
  // `zone` is always truthy (resolveZone is total); the guard is retained
  // to avoid reindenting ~340 lines of body, not as a meaningful check.
  if (zone) {
    const storedToken = realUser
      ? getStoredToken(realUser.id, realUser.zone)
      : getStoredToken(undefined, zone);

    if (storedToken) {
      // Apply env-var access token override (AMPLITUDE_TOKEN), if any.
      // Only overrides the access token; idToken/refreshToken stay from
      // storage because fetchAmplitudeUser needs a valid idToken.
      if (options?.accessTokenOverride) {
        storedToken.accessToken = options.accessTokenOverride;
      }

      // Silent token refresh
      const { tryRefreshToken } = await import('../utils/token-refresh.js');
      const expiresAtMs = new Date(storedToken.expiresAt).getTime();
      const refreshResult = await tryRefreshToken(
        {
          accessToken: storedToken.accessToken,
          refreshToken: storedToken.refreshToken,
          expiresAt: expiresAtMs,
        },
        zone,
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
          host: getHostFromRegion(zone),
          appId: 0,
        };
        session.activationLevel = 'none';
        session.projectHasData = false;

        // Hydrate org / project / env names when ampli.json has IDs but names
        // are still null. Without this the wizard can reach Setup with only
        // IDs resolved, so the header and /whoami can't show the project.
        const storedOrgId = projectConfig.ok
          ? projectConfig.config.OrgId
          : undefined;
        const storedProjectId = projectConfig.ok
          ? projectConfig.config.ProjectId
          : undefined;
        const needsNameHydration =
          !session.selectedOrgName ||
          !session.selectedProjectName ||
          !session.selectedEnvName;
        if (needsNameHydration && (storedOrgId || storedProjectId)) {
          try {
            const { fetchAmplitudeUser } = await import('./api.js');
            const userInfo = await fetchAmplitudeUser(
              storedToken.idToken,
              zone,
            );
            if (!session.userEmail && userInfo.email) {
              session.userEmail = userInfo.email;
            }
            for (const org of userInfo.orgs) {
              if (storedOrgId && org.id !== storedOrgId) continue;
              const project = storedProjectId
                ? org.projects.find((p) => p.id === storedProjectId)
                : org.projects[0];
              if (!project) continue;
              const sortedEnvs = (project.environments ?? [])
                .slice()
                .sort((a, b) => a.rank - b.rank);
              const matchedEnv =
                sortedEnvs.find((e) => e.app?.apiKey === localKey.key) ??
                sortedEnvs[0];
              session.selectedOrgId = org.id;
              session.selectedOrgName = org.name;
              session.selectedProjectId = project.id;
              session.selectedProjectName = project.name;
              if (matchedEnv) {
                session.selectedEnvName = matchedEnv.name;
                // Prefer the matched env's app.id (exact env the user picked);
                // fall back to extractAppId(project) which returns the
                // lowest-rank env's app when no env is selected.
                const appId = matchedEnv.app?.id ?? extractAppId(project);
                if (appId) {
                  session.selectedAppId = appId;
                  if (session.credentials) {
                    session.credentials.appId = toCredentialAppId(appId);
                  }
                }
              }
              logToFile(
                `[credential-resolution] hydrated names from local key: ${
                  org.name
                } / ${project.name} / ${matchedEnv?.name ?? '(env unknown)'}`,
              );
              break;
            }
          } catch (err) {
            // Non-fatal — credentials are already set; AuthScreen or /whoami
            // can backfill later.
            logToFile(
              `[credential-resolution] name hydration failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
      } else {
        // Fetch user data to check how many environments are available.
        const { fetchAmplitudeUser } = await import('./api.js');
        try {
          const userInfo = await fetchAmplitudeUser(storedToken.idToken, zone);
          analytics.setDistinctId(userInfo.email);
          analytics.identifyUser({ email: userInfo.email });
          const projectId = session.selectedProjectId ?? undefined;

          // Find the relevant project and its environments
          let envsWithKey: Array<{
            name: string;
            rank: number;
            app: {
              id: string;
              apiKey?: string | null;
            } | null;
          }> = [];
          for (const org of userInfo.orgs) {
            const project = projectId
              ? org.projects.find((p) => p.id === projectId)
              : org.projects[0];
            if (project?.environments) {
              envsWithKey = project.environments
                .filter((env) => env.app?.apiKey)
                .sort((a, b) => a.rank - b.rank);
              break;
            }
          }

          // Scope resolution. The agent-mode public contract is `--project-id`
          // only — project IDs are globally unique so one flag resolves to
          // exactly one (org, project, env) tuple. Legacy filters
          // (--org / --project-id / --env) still parse for CI scripts,
          // but --project-id takes precedence when both are passed to
          // avoid the "mismatching flags silently fall through" foot-gun.
          const appIdFilter = options?.appId;
          const envMatch = appIdFilter
            ? undefined
            : options?.env?.toLowerCase();
          const orgFilter = appIdFilter
            ? undefined
            : options?.org?.toLowerCase();
          const projectIdFilter = appIdFilter ? undefined : options?.projectId;
          const hasSpecificFilter = Boolean(
            appIdFilter || envMatch || projectIdFilter,
          );
          if (hasSpecificFilter) {
            for (const org of userInfo.orgs) {
              if (orgFilter && !org.name.toLowerCase().includes(orgFilter)) {
                continue;
              }
              for (const project of org.projects) {
                if (projectIdFilter && project.id !== projectIdFilter) {
                  continue;
                }
                // Sort by rank so when only --project-id narrows (no
                // --app-id / --env), we pick the highest-ranked env
                // (Production over Development), matching every other
                // env-selection path in the codebase.
                const matchedEnv = (project.environments ?? [])
                  .filter((e) => {
                    if (!e.app?.apiKey) return false;
                    if (appIdFilter && e.app.id !== appIdFilter) return false;
                    if (envMatch && e.name.toLowerCase() !== envMatch)
                      return false;
                    return true;
                  })
                  .sort((a, b) => a.rank - b.rank)[0];
                if (matchedEnv?.app?.apiKey) {
                  const apiKey = matchedEnv.app.apiKey;
                  session.selectedOrgId = org.id;
                  session.selectedOrgName = org.name;
                  session.selectedProjectId = project.id;
                  session.selectedProjectName = project.name;
                  session.selectedEnvName = matchedEnv.name;
                  session.selectedAppId = matchedEnv.app.id;
                  if (!session.userEmail && userInfo.email) {
                    session.userEmail = userInfo.email;
                  }
                  logToFile(
                    `[credential-resolution] filter matched: ${org.name} / ${project.name} / ${matchedEnv.name} (app-id=${matchedEnv.app.id})`,
                  );
                  persistApiKey(apiKey, installDir);
                  session.credentials = {
                    accessToken: storedToken.accessToken,
                    idToken: storedToken.idToken,
                    projectApiKey: apiKey,
                    host: getHostFromRegion(zone),
                    appId: toCredentialAppId(matchedEnv.app.id),
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
                `[credential-resolution] filters did not match any env: app-id=${
                  appIdFilter ?? '(none)'
                }, project-id=${projectIdFilter ?? '(none)'}, env=${
                  options?.env ?? '(none)'
                }, org=${options?.org ?? '(none)'}`,
              );
              // Populate pendingOrgs so the caller emits
              // `auth_required: env_selection_failed` (or the TUI picker)
              // instead of the misleading `no_stored_credentials` path.
              // The user IS signed in — their filters just didn't match.
              session.pendingOrgs = userInfo.orgs;
              session.pendingAuthIdToken = storedToken.idToken;
              session.pendingAuthAccessToken = storedToken.accessToken;
            }
          } else if (envsWithKey.length === 1) {
            // Single environment — auto-select
            const selectedEnv = envsWithKey[0];
            const apiKey = selectedEnv.app!.apiKey!;
            const selectedAppId = selectedEnv.app?.id ?? null;
            session.selectedEnvName = selectedEnv.name;
            session.selectedAppId = selectedAppId;

            // Populate org/project names
            for (const org of userInfo.orgs) {
              const project = projectId
                ? org.projects.find((p) => p.id === projectId)
                : org.projects[0];
              if (
                project?.environments?.some((e) => e.app?.apiKey === apiKey)
              ) {
                session.selectedOrgId = org.id;
                session.selectedOrgName = org.name;
                session.selectedProjectId = project.id;
                session.selectedProjectName = project.name;
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
              host: getHostFromRegion(zone),
              appId: toCredentialAppId(selectedAppId),
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
            zone: zone,
            projectId: session.selectedProjectId ?? undefined,
          });
          if (projectApiKey) {
            persistApiKey(projectApiKey, installDir);
            session.credentials = {
              accessToken: storedToken.accessToken,
              idToken: storedToken.idToken,
              projectApiKey,
              host: getHostFromRegion(zone),
              appId: toCredentialAppId(session.selectedAppId),
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

  // Pre-populate org/project from ampli.json so activation checks
  // have the IDs they need even when the SUSI flow was skipped.
  if (
    !session.selectedOrgId &&
    projectConfig.ok &&
    projectConfig.config.OrgId
  ) {
    session.selectedOrgId = String(projectConfig.config.OrgId);
  }
  if (
    !session.selectedProjectId &&
    projectConfig.ok &&
    projectConfig.config.ProjectId
  ) {
    session.selectedProjectId = projectConfig.config.ProjectId;
  }

  // Safety check: in TUI mode, clear credentials if no org/project ID
  // so AuthScreen can force selection. In agent/CI mode, a local API key
  // is sufficient — skip this check.
  if (
    options?.requireOrgId !== false &&
    session.credentials !== null &&
    !session.selectedOrgId &&
    !session.pendingOrgs
  ) {
    logToFile(
      '[credential-resolution] credentials set but no org/project — clearing to force AuthScreen',
    );
    session.credentials = null;
  }
}

/**
 * Resolve environment selection from pendingOrgs.
 *
 * Given a selected org ID, project ID, and environment name,
 * populates session.credentials from the matching environment.
 * Returns true if credentials were populated.
 */
export async function resolveEnvironmentSelection(
  session: WizardSession,
  selection: { orgId: string; projectId: string; env: string },
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

  const project = org.projects.find((p) => p.id === selection.projectId);
  if (!project) {
    logToFile(
      `[credential-resolution] project not found: ${selection.projectId}`,
    );
    return false;
  }

  const env = project.environments?.find(
    (e) => e.name.toLowerCase() === selection.env.toLowerCase(),
  );
  if (!env?.app?.apiKey) {
    logToFile(
      `[credential-resolution] environment not found or has no API key: ${selection.env}`,
    );
    return false;
  }

  // readDisk: true — credential resolution runs before the RegionSelect gate;
  // session.region may not be set yet.
  const zone = resolveZone(session, DEFAULT_AMPLITUDE_ZONE, { readDisk: true });
  const apiKey = env.app.apiKey;

  session.selectedOrgId = org.id;
  session.selectedOrgName = org.name;
  session.selectedProjectId = project.id;
  session.selectedProjectName = project.name;
  session.selectedEnvName = env.name;

  // Extract the numeric Amplitude app ID for MCP-based event detection.
  // Prefer the selected env's app.id — it matches the chosen environment
  // exactly, whereas extractAppId(project) falls back to the lowest-ranked
  // env's app when no env is selected.
  const appId = env.app?.id ?? extractAppId(project);
  session.selectedAppId = appId;

  persistApiKey(apiKey, session.installDir);
  session.credentials = {
    accessToken: session.pendingAuthAccessToken ?? '',
    idToken: session.pendingAuthIdToken ?? undefined,
    projectApiKey: apiKey,
    host: getHostFromRegion(zone),
    appId: toCredentialAppId(appId),
  };
  session.activationLevel = 'none';
  session.projectHasData = false;

  logToFile(
    `[credential-resolution] resolved environment: ${org.name} / ${project.name} / ${env.name}`,
  );
  return true;
}
