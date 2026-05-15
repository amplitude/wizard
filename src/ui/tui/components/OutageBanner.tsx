/**
 * OutageBanner — one-line status strip pinned above the JourneyStepper.
 *
 * Gated on `WIZARD_NEW_UX === '1'` at the mount site (App.tsx). When the
 * underlying `checkAmplitudeOverallHealth` rollup returns `degraded` or
 * `down`, the banner renders a single high-contrast row carrying both a
 * status glyph and a label — color is never the only signal.
 *
 *   ⚠ Amplitude services degraded
 *   ✗ Amplitude services unavailable
 *
 * Healthy responses render nothing — the banner reserves no vertical
 * space when there's no incident to surface.
 *
 * Caching: a module-scoped cache holds the last fetch result for 5
 * minutes (FETCH_TTL_MS) so a re-mount of the App tree (Ink reconciler,
 * screen transition that unmounts/remounts the chrome) doesn't issue
 * fresh HTTP every time. The cache key is the fetcher identity; tests
 * inject their own fetcher and the cache keys by reference.
 *
 * Fetcher strategy: when no override is provided, the banner delegates
 * to `checkAmplitudeOverallHealth` from `src/lib/health-checks/`. That
 * helper has its own 5-second internal timeout, so a hung statuspage
 * host cannot freeze this component.
 */

import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { Colors, Icons, Brand } from '../styles.js';
import {
  checkAmplitudeOverallHealth,
  ServiceHealthStatus,
} from '../../../lib/health-checks/index.js';
import type { BaseHealthResult } from '../../../lib/health-checks/types.js';

/** 5-minute TTL — matches the OutageScreen poll cap. */
export const FETCH_TTL_MS = 5 * 60 * 1000;

/** Status the banner cares about — narrower than the full SDK enum. */
export type OutageBannerStatus = 'ok' | 'degraded' | 'down';

/**
 * Module-scoped cache. Keyed by fetcher identity so tests can re-key by
 * passing a fresh fn each time. Tests that need to reset state can call
 * `__resetOutageBannerCache()` below.
 */
type CacheEntry = { fetchedAt: number; status: OutageBannerStatus };
const fetchCache = new WeakMap<OutageBannerFetcher, CacheEntry>();

export type OutageBannerFetcher = () => Promise<OutageBannerStatus>;

/** Default fetcher: maps the statuspage rollup into our 3-state status. */
export const defaultOutageFetcher: OutageBannerFetcher = async () => {
  try {
    const result: BaseHealthResult = await checkAmplitudeOverallHealth();
    return mapHealthStatus(result.status);
  } catch {
    // Treat network errors as "ok" rather than alarming the user when
    // the wizard itself is offline — they'll see a connection error
    // through the normal channels.
    return 'ok';
  }
};

export function mapHealthStatus(status: ServiceHealthStatus): OutageBannerStatus {
  if (status === ServiceHealthStatus.Down) return 'down';
  if (status === ServiceHealthStatus.Degraded) return 'degraded';
  return 'ok';
}

/** Test hook — clear the cache between test cases. */
export function __resetOutageBannerCache(): void {
  // WeakMap has no `clear()`, but reassigning the variable would break
  // existing closures. Instead, fetcher-keyed entries auto-expire when
  // the fetcher reference is GC'd. For tests that want explicit reset,
  // they pass a fresh fetcher per case.
}

interface OutageBannerProps {
  /** Override fetcher — tests inject a deterministic resolver. */
  fetcher?: OutageBannerFetcher;
  /** Override now() — tests pin time so the TTL check is deterministic. */
  now?: () => number;
}

/**
 * One-line outage banner. Rendered as `null` when status is `ok`.
 */
export const OutageBanner = ({
  fetcher = defaultOutageFetcher,
  now = Date.now,
}: OutageBannerProps = {}) => {
  const [status, setStatus] = useState<OutageBannerStatus>(() => {
    // Synchronously hydrate from the cache on first render so a re-mount
    // that happens within the TTL window renders the banner immediately
    // rather than blinking blank for one tick.
    const cached = fetchCache.get(fetcher);
    if (cached && now() - cached.fetchedAt < FETCH_TTL_MS) {
      return cached.status;
    }
    return 'ok';
  });

  useEffect(() => {
    let cancelled = false;
    const cached = fetchCache.get(fetcher);
    if (cached && now() - cached.fetchedAt < FETCH_TTL_MS) {
      // Cache hit — already reflected in initial state above. Skip the
      // network call entirely.
      return;
    }
    void (async () => {
      try {
        const next = await fetcher();
        if (cancelled) return;
        fetchCache.set(fetcher, { fetchedAt: now(), status: next });
        setStatus(next);
      } catch {
        // Fetcher already swallows its own errors; defensive catch keeps
        // a thrown override from breaking the banner.
        if (!cancelled) setStatus('ok');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetcher, now]);

  if (status === 'ok') return null;

  const { glyph, label, color } = describe(status);
  return (
    <Box paddingX={1}>
      <Text color={color} bold>
        {glyph} {label}
      </Text>
    </Box>
  );
};

/**
 * Glyph + label + color per status. Glyph is non-optional — color is
 * never the only signal a degraded/down state carries.
 */
function describe(status: Exclude<OutageBannerStatus, 'ok'>): {
  glyph: string;
  label: string;
  color: string;
} {
  if (status === 'down') {
    return {
      glyph: Icons.cross,
      label: 'Amplitude services unavailable',
      color: Colors.error,
    };
  }
  return {
    glyph: Icons.warning,
    label: 'Amplitude services degraded',
    // Lilac per design — distinct from the amber warning we reserve for
    // local agent issues (retries, rate limit, etc.).
    color: Brand.lilac,
  };
}
