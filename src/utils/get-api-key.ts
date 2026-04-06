import { readApiKeyWithSource } from './api-key-store.js';
import { fetchAmplitudeUser } from '../lib/api.js';
import type { AmplitudeZone } from '../lib/constants.js';

/**
 * Resolve the Amplitude project API key for a given install directory.
 *
 * Resolution order:
 *   1. Local storage — keychain / .env.local / AMPLITUDE_API_KEY env var
 *   2. Amplitude backend — fetches org/workspace data with the provided
 *      OAuth id_token and picks the lowest-ranked environment's API key
 *
 * Returns null only if both sources come up empty.
 */
export async function getAPIKey(params: {
  installDir: string;
  idToken: string;
  zone: AmplitudeZone;
  workspaceId?: string;
}): Promise<string | null> {
  const { installDir, idToken, zone, workspaceId } = params;

  // ── 1. Local storage ────────────────────────────────────────────────────────
  const stored = readApiKeyWithSource(installDir);
  if (stored) return stored.key;

  // ── 2. Amplitude backend ────────────────────────────────────────────────────
  try {
    const userInfo = await fetchAmplitudeUser(idToken, zone);

    for (const org of userInfo.orgs) {
      const workspace = workspaceId
        ? org.workspaces.find((ws) => ws.id === workspaceId)
        : org.workspaces[0];

      if (!workspace?.environments) continue;

      const envsWithKey = workspace.environments
        .filter((env) => env.app?.apiKey)
        .sort((a, b) => a.rank - b.rank);

      const apiKey = envsWithKey[0]?.app?.apiKey;
      if (apiKey) return apiKey;
    }
  } catch {
    // Backend fetch failed — caller falls back to prompting the user
  }

  return null;
}
