/**
 * Layer 1, criterion 13 — every confirmed event in the plan has at
 * least one corresponding `track()` call.
 *
 * Heavy (10 pts). The wire-format authoritative source for "what the
 * agent committed to track" is `event_plan_confirmed` (NOT
 * `event_plan_proposed` — we grade against decisions, not floats).
 *
 * Cheap implementation: regex over `track('Event Name')` and
 * `track("Event Name")` callsites. Computed names — `track(eventName)`
 * where `eventName` is a variable — are not detected here; that's a
 * Layer 2 AST concern. If a fixture's track names start coming through
 * as variables, surface them as a separate soft warning rather than
 * tightening this scorer.
 *
 * Falls back to comparing against `scenario.expectedEvents` when the
 * run log has no `event_plan_confirmed` event (defensive — golden
 * artifacts that pre-date the wire-format event will still produce
 * signal).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { EventPlanConfirmedData } from '../../../src/lib/agent-events.js';
import type { Artifact, Scenario, Scorer } from '../../runner/types.js';

const SCAN_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const TRACK_LITERAL = /\btrack\s*\(\s*(['"])((?:\\.|(?!\1).)*?)\1/g;

function collectConfirmedEventNames(artifact: Artifact): string[] {
  const out = new Set<string>();
  for (const env of artifact.runLog) {
    const data = env.data as { event?: string } | undefined;
    if (data?.event === 'event_plan_confirmed') {
      // The decision-bearing event doesn't carry the names directly.
      // The names live on the preceding `event_plan_proposed`. Walk
      // back to the most recent proposed plan and use that.
      // Fall through — we resolve below.
    }
  }
  // Strategy: take the LAST `event_plan_proposed` before the LAST
  // `event_plan_confirmed`. If there's a confirmed event at all, the
  // proposal it confirmed is the canonical list.
  let lastProposedIndex = -1;
  let confirmedIndex = -1;
  for (let i = 0; i < artifact.runLog.length; i++) {
    const data = artifact.runLog[i].data as
      | { event?: string; events?: Array<{ name?: string }> }
      | undefined;
    if (data?.event === 'event_plan_proposed') lastProposedIndex = i;
    if (data?.event === 'event_plan_confirmed') confirmedIndex = i;
  }
  if (confirmedIndex >= 0 && lastProposedIndex >= 0) {
    const proposed = artifact.runLog[lastProposedIndex].data as {
      events?: Array<{ name?: string }>;
    };
    for (const ev of proposed.events ?? []) {
      if (typeof ev.name === 'string') out.add(ev.name);
    }
    // Also honour `decision = 'skipped'` — if the agent skipped the
    // plan, there's nothing to track. Caller treats empty set as pass.
    const decision = artifact.runLog[confirmedIndex].data as
      | EventPlanConfirmedData
      | undefined;
    if (decision?.decision === 'skipped') return [];
  }
  return [...out];
}

function collectTrackedEventNames(
  artifact: Artifact,
  root: string,
): Set<string> {
  const out = new Set<string>();
  const candidates = [
    ...artifact.fsSnapshot.diff.added,
    ...artifact.fsSnapshot.diff.modified,
  ].filter((p) => SCAN_EXTS.some((ext) => p.endsWith(ext)));
  for (const path of candidates) {
    let text: string;
    try {
      text = readFileSync(join(root, path), 'utf8');
    } catch {
      continue;
    }
    for (const m of text.matchAll(TRACK_LITERAL)) {
      out.add(m[2]);
    }
  }
  return out;
}

export const scorer: Scorer = {
  id: 'L1-confirmed-events-tracked',
  layer: 1,
  criterion: 13,
  description:
    'Every confirmed event in the plan must have at least one track() call.',
  evaluate(artifact: Artifact, scenario: Scenario) {
    const root = process.env.EVALS_WORKING_DIR;
    if (!root) {
      return {
        pass: true,
        weight: 0,
        detail: 'EVALS_WORKING_DIR unset; cannot scan tree for track() calls',
      };
    }
    let confirmed = collectConfirmedEventNames(artifact);
    if (confirmed.length === 0) {
      // Fall back to the scenario's expected event list when the run
      // log lacks a confirmed plan. Better than a no-op pass, and
      // documents that the scenario itself made a claim.
      confirmed = scenario.expectedEvents;
    }
    if (confirmed.length === 0) {
      return {
        pass: true,
        weight: 10,
        detail: 'no confirmed events to verify (event plan empty or skipped)',
      };
    }
    const tracked = collectTrackedEventNames(artifact, root);
    const missing = confirmed.filter((n) => !tracked.has(n));
    if (missing.length === 0) return { pass: true, weight: 10 };
    return {
      pass: false,
      weight: 10,
      detail: `confirmed events without a track() call: ${missing.join(', ')}`,
    };
  },
};
