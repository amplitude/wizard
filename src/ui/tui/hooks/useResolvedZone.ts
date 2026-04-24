/**
 * Zone resolution for React components, without disk I/O.
 *
 * `resolveZone` walks three tiers to find the effective zone:
 * (1) `session.region`, (2) `ampli.json` Zone, (3) stored user zone.
 * Tiers 2 and 3 require synchronous disk reads via `readAmpliConfig` /
 * `getStoredUser`. Calling the full chain in a component render body
 * re-runs those reads on every render — wasteful on screens that
 * re-render from local state, timers, or store subscriptions.
 *
 * This hook passes `{ readDisk: false }` so only Tier 1 is consulted.
 * That skips the disk reads entirely — no staleness (no disk cache to
 * go stale), no per-render I/O. Safe because every consumer of this
 * hook runs after RegionSelect / auth has populated `session.region`,
 * making Tier 1 the authoritative answer.
 *
 * If you find yourself wanting this hook for a screen that might
 * render before `session.region` is set (e.g. a new early-flow
 * screen), do NOT add Tier 2/3 back here — prefer hoisting zone
 * resolution up to a parent and threading it as a prop. File-backed
 * values aren't reactive and don't belong in render-path reads.
 */
import { useMemo } from 'react';
import type { WizardSession } from '../../../lib/wizard-session.js';
import {
  DEFAULT_AMPLITUDE_ZONE,
  type AmplitudeZone,
} from '../../../lib/constants.js';
import { resolveZone } from '../../../lib/zone-resolution.js';

export function useResolvedZone(session: WizardSession): AmplitudeZone {
  return useMemo(
    () => resolveZone(session, DEFAULT_AMPLITUDE_ZONE, { readDisk: false }),
    [session.region],
  );
}
