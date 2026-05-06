/**
 * Layer 1, criterion 19 — `setup_complete` event is present and well-
 * shaped on a successful run.
 *
 * Medium (5 pts). Verifies the basic shape: exactly one
 * `setup_complete` precedes a successful `run_completed`, and it
 * carries the fields downstream tooling reads (`amplitude.appId`,
 * `files`, `events`).
 *
 * The deeper "setup_complete agrees with the filesystem" check is
 * `setup-report-accurate.ts`. This scorer is the cheap shape gate;
 * the cross-check between report and reality is its own scorer.
 */

import type { SetupCompleteData } from '../../../src/lib/agent-events.js';
import type { Artifact, Scenario, Scorer } from '../../runner/types.js';

function findSetupComplete(artifact: Artifact): SetupCompleteData | undefined {
  for (const env of artifact.runLog) {
    const data = env.data as SetupCompleteData | undefined;
    if (data?.event === 'setup_complete') return data;
  }
  return undefined;
}

export const scorer: Scorer = {
  id: 'L1-setup-complete-shape',
  layer: 1,
  criterion: 19,
  description:
    'setup_complete must be present on success and carry the canonical fields.',
  evaluate(artifact: Artifact, _scenario: Scenario) {
    const sc = findSetupComplete(artifact);
    if (!sc) {
      return {
        pass: false,
        weight: 5,
        detail: 'no setup_complete event found in run log',
      };
    }
    const missing: string[] = [];
    if (!sc.amplitude || typeof sc.amplitude !== 'object') {
      missing.push('amplitude');
    }
    if (!sc.files || (!sc.files.written && !sc.files.modified)) {
      missing.push('files');
    }
    if (!Array.isArray(sc.events)) missing.push('events');
    if (missing.length > 0) {
      return {
        pass: false,
        weight: 5,
        detail: `setup_complete missing required fields: ${missing.join(', ')}`,
      };
    }
    return { pass: true, weight: 5 };
  },
};
