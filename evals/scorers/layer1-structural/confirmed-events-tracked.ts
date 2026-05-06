/**
 * Layer 1 — criterion 13: every confirmed event has a track() call.
 *
 * Compares `event_plan_confirmed` events from the run log against literal
 * first-arg strings of `track(...)` calls in the diffed files. Variable-named
 * `track(eventName)` calls are not counted — they get a soft warn elsewhere.
 *
 * AST integration is deferred — this scaffold uses a regex over JS/TS files
 * as a placeholder so the scorer is exercise-able end-to-end. Promote to
 * @typescript-eslint/parser before relying on it for prompt-tuning verdicts.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Artifact, Scorer } from '../../runner/types.js';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

const TRACK_LITERAL = /\btrack\s*\(\s*(['"])([^'"]+)\1/g;

const scorer: Scorer = {
  id: 'L1-confirmed-events-tracked',
  layer: 1,
  criterion: 13,
  evaluate(artifact: Artifact) {
    const confirmed = collectConfirmedEvents(artifact);
    if (confirmed.length === 0) {
      // Sentinel — the run never confirmed an event plan. Distinct from
      // criterion 14 (which catches the no-track-calls case) and graded
      // as a warn via weight=0 so the suite doesn't double-penalize.
      return {
        id: 'L1-confirmed-events-tracked',
        criterion: 13,
        pass: true,
        weight: 0,
        detail: 'no event_plan_confirmed in run log; nothing to verify',
      };
    }

    const tracked = collectTrackCallNames(artifact);
    const missing = confirmed.filter((e) => !tracked.has(e));
    if (missing.length === 0) {
      return {
        id: 'L1-confirmed-events-tracked',
        criterion: 13,
        pass: true,
        weight: 10,
      };
    }
    return {
      id: 'L1-confirmed-events-tracked',
      criterion: 13,
      pass: false,
      weight: 10,
      detail: `confirmed events without a track() call: ${missing.join(', ')}`,
    };
  },
};

function collectConfirmedEvents(artifact: Artifact): string[] {
  const names = new Set<string>();
  for (const ev of artifact.runLog) {
    const data = ev.data as
      | { event?: string; events?: Array<{ name?: string }> }
      | undefined;
    if (data?.event !== 'event_plan_confirmed') continue;
    for (const e of data.events ?? []) {
      if (typeof e.name === 'string') names.add(e.name);
    }
  }
  return [...names];
}

function collectTrackCallNames(artifact: Artifact): Set<string> {
  const found = new Set<string>();
  const workingRoot = join(
    REPO_ROOT,
    'evals',
    'fixtures',
    artifact.scenarioDef.fixture,
    'working',
  );
  const candidates = [
    ...artifact.fsSnapshot.diff.added,
    ...artifact.fsSnapshot.diff.modified,
  ].filter((p) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p));

  for (const rel of candidates) {
    let text: string;
    try {
      text = readFileSync(join(workingRoot, rel), 'utf8');
    } catch {
      continue;
    }
    for (const match of text.matchAll(TRACK_LITERAL)) {
      found.add(match[2]);
    }
  }
  return found;
}

export default scorer;
