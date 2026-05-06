/**
 * Scorer registry + dispatcher.
 *
 * Each scorer module under `evals/scorers/<layer>/<name>.ts` exports a default
 * `Scorer`. The registry imports them eagerly (no dynamic glob) so the type
 * checker catches a missing scorer at compile time, not at run time.
 *
 * Adding a scorer? Drop the import below AND register it in the per-layer
 * arrays. We resisted dynamic discovery on purpose — the registration list
 * is also our PR-review surface for "does this scorer belong on Layer X."
 */
import type { LayerId, Scorer } from './types.js';

import noHardcodedKey from '../scorers/layer0-hard-fail/no-hardcoded-key.js';
import confirmedEventsTracked from '../scorers/layer1-structural/confirmed-events-tracked.js';

/** Scorers indexed by layer. Order within a layer is preserved for reports. */
export const SCORERS_BY_LAYER: Record<LayerId, Scorer[]> = {
  0: [noHardcodedKey],
  1: [confirmedEventsTracked],
  2: [],
  3: [],
  4: [],
  5: [],
  6: [],
};

export function getScorers(layers: LayerId[]): Scorer[] {
  return layers.flatMap((l) => SCORERS_BY_LAYER[l] ?? []);
}
