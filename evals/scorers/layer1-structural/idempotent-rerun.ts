/**
 * Layer 1, criterion 16 — re-running the wizard on the same project
 * should be a no-op (or only emit `modify` operations on files the
 * first run already touched).
 *
 * Medium (5 pts). Compares `file_change_applied` events from the
 * second run (carried on `Artifact.secondRunLog`) against the first.
 * A clean re-run shouldn't:
 *   - Create new files the first run didn't already create.
 *   - Delete files the first run created.
 *   - Modify files the first run never touched.
 *
 * If `secondRunLog` is absent, the scorer skip-passes with weight 0 —
 * absence is a "no signal" state, not a failure. Scenarios that want
 * to grade idempotency must opt in by recording a second run (live:
 * runTwice; golden: pin `golden/run-second.ndjson`).
 */

import type {
  AgentEventEnvelope,
  FileChangeAppliedData,
} from '../../../src/lib/agent-events.js';
import type { Artifact, Scorer } from '../../runner/types.js';

interface FileChange {
  path: string;
  operation: 'create' | 'modify' | 'delete';
}

function collectFileChanges(events: AgentEventEnvelope[]): FileChange[] {
  const out: FileChange[] = [];
  for (const env of events) {
    const data = env.data as FileChangeAppliedData | undefined;
    if (data?.event === 'file_change_applied') {
      out.push({ path: data.path, operation: data.operation });
    }
  }
  return out;
}

export const scorer: Scorer = {
  id: 'L1-idempotent-rerun',
  layer: 1,
  criterion: 16,
  description:
    'Second wizard run on the same project must not create new files or delete first-run outputs.',
  evaluate(artifact: Artifact) {
    if (!artifact.secondRunLog) {
      return {
        pass: true,
        weight: 0,
        detail: 'skipped: no secondRunLog on artifact',
      };
    }

    const firstChanges = collectFileChanges(artifact.runLog);
    const secondChanges = collectFileChanges(artifact.secondRunLog);

    const firstTouched = new Set(firstChanges.map((c) => c.path));
    const surpriseCreates = secondChanges.filter(
      (c) => c.operation === 'create' && !firstTouched.has(c.path),
    );
    const surpriseDeletes = secondChanges.filter(
      (c) => c.operation === 'delete' && firstTouched.has(c.path),
    );
    const surpriseModifies = secondChanges.filter(
      (c) => c.operation === 'modify' && !firstTouched.has(c.path),
    );

    const offenders = [
      ...surpriseCreates.map((c) => `created ${c.path}`),
      ...surpriseDeletes.map((c) => `deleted ${c.path}`),
      ...surpriseModifies.map((c) => `modified ${c.path}`),
    ];

    if (offenders.length === 0) {
      return { pass: true, weight: 5 };
    }
    return {
      pass: false,
      weight: 5,
      detail: `second run produced surprise file changes: ${offenders
        .slice(0, 5)
        .join('; ')}${
        offenders.length > 5 ? ` (+${offenders.length - 5} more)` : ''
      }`,
    };
  },
};
