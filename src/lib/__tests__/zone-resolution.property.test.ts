/**
 * Property-based test for zone resolution.
 *
 * Property: resolveZone returns the highest-priority present signal per
 * the documented tier ordering, or the caller-supplied fallback if no
 * signal is present.
 *
 * A separate call-site-drift guard lives in zone-resolution.invariants.test.ts
 * (grep-based forbidden-patterns check) — trying to assert the same thing
 * here by calling resolveZone multiple times and comparing outputs was
 * tautological, since the helper is total and the callers share it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { resolveZone } from '../zone-resolution.js';
import { buildSession } from '../wizard-session.js';
import type { AmplitudeZone } from '../constants.js';

vi.mock('../ampli-config.js', () => ({
  readAmpliConfig: vi.fn(() => ({ ok: false, error: 'not_found' })),
}));

vi.mock('../../utils/ampli-settings.js', () => ({
  getStoredUser: vi.fn(() => undefined),
}));

const zoneArb: fc.Arbitrary<AmplitudeZone> = fc.constantFrom('us', 'eu');

/** Optional zone — represents "signal present or absent." */
const optionalZoneArb = fc.option(zoneArb, { nil: null });

/** One StoredUser shape: either real, pending, or absent. */
const storedUserArb = fc.option(
  fc.record({
    kind: fc.constantFrom<'real', 'pending'>('real', 'pending'),
    zone: zoneArb,
  }),
  { nil: null },
);

interface Scenario {
  intent: AmplitudeZone | null; // session.region
  projectZone: AmplitudeZone | null; // ampli.json Zone
  storedUser: { kind: 'real' | 'pending'; zone: AmplitudeZone } | null;
  fallback: AmplitudeZone;
}

async function applyScenario(s: Pick<Scenario, 'projectZone' | 'storedUser'>) {
  const { readAmpliConfig } = await import('../ampli-config.js');
  const { getStoredUser } = await import('../../utils/ampli-settings.js');
  vi.mocked(readAmpliConfig).mockReturnValue(
    s.projectZone != null
      ? { ok: true, config: { Zone: s.projectZone } }
      : { ok: false, error: 'not_found' },
  );
  vi.mocked(getStoredUser).mockReturnValue(
    s.storedUser == null
      ? undefined
      : {
          id: s.storedUser.kind === 'pending' ? 'pending' : 'user-123',
          email: 'x@x',
          firstName: 'x',
          lastName: 'x',
          zone: s.storedUser.zone,
        },
  );
}

function expectedZone(s: Scenario): AmplitudeZone {
  if (s.intent != null) return s.intent;
  if (s.projectZone != null) return s.projectZone;
  if (s.storedUser?.kind === 'real') return s.storedUser.zone;
  if (s.storedUser?.kind === 'pending') return s.storedUser.zone;
  return s.fallback;
}

describe('resolveZone — property tests', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns highest-priority present signal (or fallback)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          intent: optionalZoneArb,
          projectZone: optionalZoneArb,
          storedUser: storedUserArb,
          fallback: zoneArb,
        }),
        async (scenario) => {
          await applyScenario(scenario);
          const session = buildSession({});
          session.region = scenario.intent;

          const result = resolveZone(session, scenario.fallback, {
            readDisk: true,
          });
          expect(result).toBe(expectedZone(scenario));
        },
      ),
      { numRuns: 200 },
    );
  });
});
