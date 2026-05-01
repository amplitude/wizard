import { readApiKeyWithSource } from './api-key-store.js';
import { fetchAmplitudeUser } from '../lib/api.js';
import { logToFile } from './debug.js';
import type { AmplitudeZone } from '../lib/constants.js';

/**
 * Resolve the Amplitude project API key for a given install directory.
 *
 * Resolution order:
 *   1. Local storage — per-user `~/.amplitude/wizard/credentials.json`,
 *      then project-local `.env.local` (see `api-key-store.ts`).
 *   2. Amplitude backend — fetches org/project data with the provided
 *      OAuth id_token and picks the lowest-ranked environment's API key.
 *
 * Returns null only if both sources come up empty.
 */
export async function getAPIKey(params: {
  installDir: string;
  idToken: string;
  zone: AmplitudeZone;
  projectId?: string;
}): Promise<string | null> {
  const { installDir, idToken, zone, projectId } = params;

  // ── 1. Local storage ────────────────────────────────────────────────────────
  const stored = readApiKeyWithSource(installDir);
  if (stored) return stored.key;

  // ── 2. Amplitude backend ────────────────────────────────────────────────────
  try {
    const userInfo = await fetchAmplitudeUser(idToken, zone);
    let foundProject = false;
    let foundEnvWithKey = false;

    for (const org of userInfo.orgs) {
      const project = projectId
        ? org.projects.find((p) => p.id === projectId)
        : org.projects[0];

      if (!project?.environments) continue;
      foundProject = true;

      const envsWithKey = project.environments
        .filter((env) => env.app?.apiKey)
        .sort((a, b) => a.rank - b.rank);

      if (envsWithKey.length > 0) foundEnvWithKey = true;

      const apiKey = envsWithKey[0]?.app?.apiKey;
      if (apiKey) return apiKey;
    }

    logToFile(
      `[getAPIKey] no key found: ${userInfo.orgs.length} org(s), foundProject=${foundProject}, foundEnvWithKey=${foundEnvWithKey}`,
    );
  } catch (err) {
    logToFile(
      `[getAPIKey] backend fetch failed: ${
        err instanceof Error ? err.constructor.name : 'unknown'
      }`,
    );
  }

  return null;
}
