/**
 * Memoized zone resolution for React components.
 *
 * `resolveZone` does synchronous disk I/O on every call (`readAmpliConfig`
 * on `ampli.json`, `getStoredUser` on `~/.ampli.json`). Calling it at the
 * top level of a component body re-runs those reads on every render —
 * cheap individually, but wasteful on screens that re-render from local
 * state / timers / store subscriptions.
 *
 * This hook wraps `resolveZone` in a `useMemo` keyed on the inputs that
 * can legitimately change within a screen's lifetime (`session.region`,
 * `session.installDir`). The remaining inputs (`ampli.json` Zone and
 * stored user zone) are treated as stable for the memo's lifetime —
 * nothing inside a mounted screen rewrites those files, and every screen
 * that calls this hook runs after RegionSelect / auth have completed,
 * at which point both files are settled.
 *
 * If a future screen mounts before those writes happen, or something
 * begins mutating `ampli.json` mid-screen, prefer to hoist zone
 * resolution up to a parent and thread it as a prop rather than
 * extending this hook's dep array — file mtimes aren't reactive.
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
    () => resolveZone(session, DEFAULT_AMPLITUDE_ZONE),
    [session.region, session.installDir],
  );
}
