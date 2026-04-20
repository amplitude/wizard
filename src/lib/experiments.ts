/**
 * Typed experiment registry for PR 3.2 (observability spine).
 *
 * Sits on top of the Amplitude Experiment client in `feature-flags.ts` and
 * adds:
 *   - declarative variant definitions with a typed default
 *   - `useExperiment()` that fires `wizard cli: experiment exposed` exactly
 *     once per flag per run
 *   - per-run memoization of resolved variants so checkpoint resume sees the
 *     same bucket as the original run
 *
 * Usage:
 *   const variant = useExperiment(EXP_AGENT_ANALYTICS);
 *   if (variant === 'on') { ... }
 */

import { analytics } from '../utils/analytics';
import { getFlag } from './feature-flags';
import { getRunId } from './observability';

// ── Types ────────────────────────────────────────────────────────────

/** Scope governs when bucketing should change. Informational for now. */
export type ExperimentScope = 'per-run' | 'per-user' | 'per-org';

export interface ExperimentDef<V extends string> {
  /** Flag key in Amplitude Experiment (e.g. 'wizard-agent-analytics'). */
  key: string;
  description: string;
  defaultVariant: V;
  variants: Record<V, { description: string }>;
  scope: ExperimentScope;
}

// ── Seeded experiment defs ───────────────────────────────────────────

export const EXP_AGENT_ANALYTICS: ExperimentDef<'on' | 'off'> = {
  key: 'wizard-agent-analytics',
  description:
    'Enables wizard agent-level analytics. Default on; off disables SDK track()s.',
  defaultVariant: 'on',
  variants: {
    on: { description: 'Analytics enabled (default).' },
    off: { description: 'Analytics disabled.' },
  },
  scope: 'per-user',
};

export const EXP_LLM_ANALYTICS: ExperimentDef<'on' | 'off'> = {
  key: 'wizard-llm-analytics',
  description:
    'Gates the LLM analytics additional-feature flow at the end of the run.',
  defaultVariant: 'off',
  variants: {
    on: { description: 'Offer LLM analytics setup.' },
    off: { description: 'Skip LLM analytics step.' },
  },
  scope: 'per-user',
};

// ── Runtime bookkeeping ──────────────────────────────────────────────

/**
 * Per-run resolved-variant cache. A checkpoint roundtrip can hydrate this so
 * a resumed run sees the same bucketing it did on the original run.
 */
const assignments = new Map<string, string>();
/** Track which flags have already fired an `experiment exposed` event. */
const exposed = new Set<string>();

/** Resolve the current variant for a typed experiment and fire exposure once. */
export function useExperiment<V extends string>(def: ExperimentDef<V>): V {
  // Prefer a pre-seeded assignment (from checkpoint hydration) so resumed
  // runs stay in the same bucket they started in.
  let variant: V | undefined = assignments.get(def.key) as V | undefined;
  if (!variant) {
    const raw = getFlag(def.key);
    variant =
      raw && (raw as V) in def.variants ? (raw as V) : def.defaultVariant;
    assignments.set(def.key, variant);
  }

  if (!exposed.has(def.key)) {
    exposed.add(def.key);
    analytics.wizardCapture('experiment exposed', {
      flag: def.key,
      variant,
      'run id': getRunId(),
    });
  }
  return variant;
}

/** Snapshot current assignments for persistence in the session checkpoint. */
export function getAssignments(): Record<string, string> {
  return Object.fromEntries(assignments);
}

/** Restore assignments from a checkpoint. Clears existing state first. */
export function setAssignments(values: Record<string, string>): void {
  assignments.clear();
  for (const [k, v] of Object.entries(values)) {
    assignments.set(k, v);
  }
}

/** Test-only reset. */
export function _resetForTest(): void {
  assignments.clear();
  exposed.clear();
}
