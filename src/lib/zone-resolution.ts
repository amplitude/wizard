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

export function resolveZone(
  session: WizardSession,
  fallback: AmplitudeZone,
): AmplitudeZone {
  // Tier 1: explicit user intent for this run.
  if (session.region != null) {
    return session.region as AmplitudeZone;
  }

  // Tier 2: project config (ampli.json Zone).
  const projectConfig = readAmpliConfig(session.installDir);
  if (projectConfig.ok && projectConfig.config.Zone != null) {
    return projectConfig.config.Zone;
  }

  // Tier 3: real stored user's home zone.
  const storedUser = getStoredUser();
  if (storedUser && storedUser.id !== 'pending' && storedUser.zone != null) {
    return storedUser.zone;
  }

  // Tier 4: pending-user zone (#165 recovery path — a prior signup left a
  // pending sentinel because fetchAmplitudeUser failed, but the zone it was
  // going to is still usable).
  if (storedUser && storedUser.id === 'pending' && storedUser.zone != null) {
    return storedUser.zone;
  }

  // Tier 5: caller-supplied fallback.
  return fallback;
}
