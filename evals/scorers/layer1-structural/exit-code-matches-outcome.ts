/**
 * Layer 1, contract assertion 4 — exit code matches `run_completed.outcome`.
 *
 * Medium (5 pts). The runner's parse layer also enforces this and
 * surfaces a contract violation; we duplicate the check as a scorer
 * so it lands in the per-criterion JSON report rather than only the
 * runner-level errors block. This makes triage simpler — engineers
 * reading the report don't have to know to check two different
 * sections to see whether the wizard's exit funnel and NDJSON
 * terminal event agree.
 *
 * If parse-stream's `assertContract` already flagged this as a
 * violation, the runner records it as a runner error; this scorer
 * records the same fact under the criterion grid.
 */

import type { RunCompletedData } from '../../../src/lib/agent-events.js';
import { ExitCode } from '../../../src/lib/exit-codes.js';
import type { Artifact, Scenario, Scorer } from '../../runner/types.js';

function findRunCompleted(artifact: Artifact): RunCompletedData | undefined {
  for (const env of artifact.runLog) {
    const data = env.data as RunCompletedData | undefined;
    if (data?.event === 'run_completed') return data;
  }
  return undefined;
}

function validExitCodesForOutcome(outcome: string): number[] {
  switch (outcome) {
    case 'success':
      return [ExitCode.SUCCESS];
    case 'cancelled':
      return [ExitCode.USER_CANCELLED];
    case 'error':
      return [
        ExitCode.GENERAL_ERROR,
        ExitCode.INVALID_ARGS,
        ExitCode.AUTH_REQUIRED,
        ExitCode.NETWORK_ERROR,
        ExitCode.AGENT_FAILED,
        ExitCode.PROJECT_NAME_TAKEN,
        ExitCode.INPUT_REQUIRED,
        ExitCode.WRITE_REFUSED,
        ExitCode.INTERNAL_ERROR,
      ];
    default:
      return [];
  }
}

export const scorer: Scorer = {
  id: 'L1-exit-code-matches-outcome',
  layer: 1,
  criterion: 19,
  description:
    'Process exit code must be consistent with run_completed.outcome.',
  evaluate(artifact: Artifact, _scenario: Scenario) {
    const rc = findRunCompleted(artifact);
    if (!rc) {
      return {
        pass: false,
        weight: 5,
        detail: 'no run_completed event in run log',
      };
    }
    const valid = validExitCodesForOutcome(rc.outcome);
    if (!valid.includes(artifact.exitCode)) {
      return {
        pass: false,
        weight: 5,
        detail: `exit code ${artifact.exitCode} not consistent with outcome=${
          rc.outcome
        } (expected one of ${valid.join(', ')})`,
      };
    }
    return { pass: true, weight: 5 };
  },
};
