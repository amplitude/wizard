/**
 * Cross-zone org probing for the no-orgs error path.
 *
 * Background — when the user picks a region (US or EU) but their Amplitude
 * organization actually lives on the OTHER region's data center, the data
 * API returns an empty `orgs` array. Without a probe, the wizard would
 * surface "No Amplitude organization found" — a dead-end that doesn't
 * tell the user they're simply on the wrong zone.
 *
 * Tokens are zone-scoped (see `getStoredToken` in `ampli-settings.ts` and
 * the issuer/audience guard added in PR #345). That means we can't reuse
 * the current zone's token to probe the other zone — we have to look up
 * a separately-stored token for the other zone in `~/.ampli.json`.
 *
 * If a token exists, we call `fetchAmplitudeUser` against the other zone
 * and report the org count back to the caller. If not, the caller should
 * surface the "degraded" copy that points to `/region` without the count.
 */

import type { AmplitudeZone } from '../lib/constants.js';
import { fetchAmplitudeUser } from '../lib/api.js';
import { getStoredToken } from './ampli-settings.js';
import { logToFile } from './debug.js';

/** Returns the opposite cloud region (us↔eu). */
export function otherZone(zone: AmplitudeZone): AmplitudeZone {
  return zone === 'us' ? 'eu' : 'us';
}

export interface OtherZoneProbeResult {
  /** The opposite zone we probed. */
  otherZone: AmplitudeZone;
  /** Number of orgs found on the other zone. `null` when no token was available to probe. */
  otherOrgCount: number | null;
}

/**
 * Probes the other zone for organizations using a separately-stored token.
 *
 * Returns:
 *  - `{ otherZone, otherOrgCount: N }` when a token was found and the API
 *    returned orgs (or 0). N >= 1 means the user has orgs they could switch to.
 *  - `{ otherZone, otherOrgCount: null }` when no token exists for the other
 *    zone (caller should fall back to degraded copy without an org count).
 *
 * Never throws — network/parse failures degrade to `otherOrgCount: null` so
 * the caller can still ship the actionable copy. The whole point of the
 * probe is to make a dead-end recoverable; failing it loud would defeat
 * that goal.
 */
export async function probeOtherZoneForOrgs(
  currentZone: AmplitudeZone,
): Promise<OtherZoneProbeResult> {
  const other = otherZone(currentZone);

  // Tokens are zone-scoped — see `getStoredToken` (zone arg) and the issuer
  // guard added in PR #345. A US token cannot authenticate against the EU
  // data API.
  const token = getStoredToken(undefined, other);
  if (!token) {
    logToFile('[zone-probe] no stored token for other zone', { other });
    return { otherZone: other, otherOrgCount: null };
  }

  try {
    const userInfo = await fetchAmplitudeUser(token.idToken, other);
    logToFile('[zone-probe] probed other zone', {
      other,
      orgCount: userInfo.orgs.length,
    });
    return { otherZone: other, otherOrgCount: userInfo.orgs.length };
  } catch (err) {
    logToFile('[zone-probe] probe failed', {
      other,
      err: err instanceof Error ? err.message : String(err),
    });
    // Treat probe failure same as "no token" — fall back to degraded copy.
    return { otherZone: other, otherOrgCount: null };
  }
}

/**
 * Error thrown when the user's authenticated zone has no organizations.
 * Carries optional metadata about the other zone so callers (TUI, agent
 * mode, CI) can render an actionable recovery action.
 */
export class NoOrgsError extends Error {
  constructor(
    message: string,
    public readonly currentZone: AmplitudeZone,
    public readonly otherZone: AmplitudeZone,
    /**
     * Org count found on the other zone. `null` when we couldn't probe
     * (no token for the other zone, or the probe API call failed).
     * `0` means we probed and confirmed neither zone has orgs.
     * `>=1` means the user can switch to the other zone to recover.
     */
    public readonly otherOrgCount: number | null,
  ) {
    super(message);
    this.name = 'NoOrgsError';
  }
}

/**
 * Build the user-facing error copy for a no-orgs situation, given probe results.
 *
 * Branches:
 *  - Other zone has orgs → explicit "switch with /region" hint with count.
 *  - Other zone has 0 orgs (probed, confirmed empty) → "different account or admin" copy.
 *  - Other zone unprobed (no token) → degraded "if your team uses X, switch with /region".
 */
export function buildNoOrgsMessage(
  currentZone: AmplitudeZone,
  result: OtherZoneProbeResult,
): string {
  const region = currentZone.toUpperCase();
  const otherRegion = result.otherZone.toUpperCase();
  const otherFlag = result.otherZone;

  // Case 1: other zone has orgs — explicit count + switch hint.
  if (result.otherOrgCount !== null && result.otherOrgCount > 0) {
    const orgWord =
      result.otherOrgCount === 1 ? 'organization' : 'organizations';
    return (
      `We didn't find any organizations in ${region}, but we see ` +
      `${result.otherOrgCount} ${orgWord} in ${otherRegion}. ` +
      `Switch with /region or re-run with --zone ${otherFlag}.`
    );
  }

  // Case 2: confirmed empty on both zones — actual "no orgs anywhere" case.
  if (result.otherOrgCount === 0) {
    return (
      `We couldn't find any Amplitude organizations linked to your account. ` +
      `Sign in with a different account, or contact your Amplitude admin.`
    );
  }

  // Case 3: degraded — couldn't probe the other zone (no token, or probe failed).
  return (
    `No organizations found in ${region}. ` +
    `If your team uses ${otherRegion}, switch with /region or re-run with --zone ${otherFlag}.`
  );
}
