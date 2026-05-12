/**
 * Layer 1, criterion 17 — agent's post-apply self-verification step
 * reports success.
 *
 * Medium (5 pts). The wizard emits one `verification_result` event per
 * verification phase (`sdk_present`, `api_key`, `ingestion`, `overall`).
 * A run that completes successfully but whose `overall` phase reports
 * `success: false` is a class of regression where the wizard ships an
 * integration it doesn't itself trust — usually a missing SDK install or
 * unwritten env var that surfaced too late to bail the run.
 *
 * The scorer treats absence of any `verification_result` as a soft pass
 * with weight 0 — the wizard may not have run verification (older
 * goldens, or a code path that skips verification on certain
 * frameworks). Presence + failure → fail; presence + all-success → pass.
 */

import type {
  AgentEventEnvelope,
  VerificationResultData,
} from '../../../src/lib/agent-events.js';
import type { Artifact, Scorer } from '../../runner/types.js';

function collectVerifications(
  events: AgentEventEnvelope[],
): VerificationResultData[] {
  const out: VerificationResultData[] = [];
  for (const env of events) {
    const data = env.data as VerificationResultData | undefined;
    if (data?.event === 'verification_result') {
      out.push(data);
    }
  }
  return out;
}

export const scorer: Scorer = {
  id: 'L1-self-verification-passes',
  layer: 1,
  criterion: 17,
  description:
    'Wizard self-verification step must report success on the overall phase.',
  evaluate(artifact: Artifact) {
    const verifications = collectVerifications(artifact.runLog);
    if (verifications.length === 0) {
      return {
        pass: true,
        weight: 0,
        detail: 'skipped: no verification_result events in run log',
      };
    }
    const failed = verifications.filter((v) => v.success !== true);
    if (failed.length === 0) {
      return { pass: true, weight: 5 };
    }
    const summary = failed
      .map((v) => {
        const reasons = v.failures?.join('; ') ?? 'unknown';
        return `${v.phase}: ${reasons}`;
      })
      .join(' | ');
    return {
      pass: false,
      weight: 5,
      detail: `verification failed on ${failed.length} phase(s): ${summary}`,
    };
  },
};
