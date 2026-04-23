/**
 * Zone resolution — single source of truth across TUI, agent, CI, classic.
 *
 * Invariant: `session.region` is set ONLY by writes that reflect user intent
 * (--region flag / env var / /region slash / RegionSelect pick / checkpoint
 * restore). All other consumers that need "what zone are we effectively in?"
 * must call `resolveZone(session, fallback)` — they must NOT read
 * `session.region` directly.
 */
import type { WizardSession } from './wizard-session.js';
import type { AmplitudeZone } from './constants.js';
import { readAmpliConfig } from './ampli-config.js';
import { getStoredUser } from '../utils/ampli-settings.js';

/**
 * Attempt to resolve the zone from explicit signals only (no fallback).
 * Returns null when no signal is available — callers that require a
 * definite regional intent (e.g. direct signup, which POSTs to
 * region-specific provisioning endpoints) should treat `null` as "user
 * must be asked" rather than silently defaulting to US.
 */
export function tryResolveZone(session: WizardSession): AmplitudeZone | null {
  // Tier 1: explicit user intent for this run.
  if (session.region != null) {
    return session.region;
  }

  // Tier 2: project config (ampli.json Zone).
  const projectConfig = readAmpliConfig(session.installDir);
  if (projectConfig.ok && projectConfig.config.Zone != null) {
    return projectConfig.config.Zone;
  }

  // Tier 3: stored user's home zone. `getStoredUser` returns at most one
  // record (real or pending); the home-zone semantics are identical for
  // both — a pending user during SUSI has the same regional intent as a
  // real user restored from ~/.ampli.json.
  const storedUser = getStoredUser();
  if (storedUser?.zone != null) {
    return storedUser.zone;
  }

  return null;
}

export function resolveZone(
  session: WizardSession,
  fallback: AmplitudeZone,
  options?: {
    /**
     * When `false`, only Tier 1 (`session.region`) is consulted; Tiers 2
     * and 3 (project config, stored user) are skipped and the fallback
     * is returned if Tier 1 is null. Pass `false` from hot paths — React
     * render bodies, high-frequency loops — where the synchronous disk
     * reads in `readAmpliConfig` and `getStoredUser` matter and the
     * caller can assert `session.region` is already populated (typically
     * because the caller runs after RegionSelect / auth).
     *
     * Defaults to `true` so `resolveZone(session, fallback)` preserves
     * its original full-chain semantics at all existing call sites.
     */
    readDisk?: boolean;
  },
): AmplitudeZone {
  if (options?.readDisk === false) {
    return session.region ?? fallback;
  }
  return tryResolveZone(session) ?? fallback;
}
